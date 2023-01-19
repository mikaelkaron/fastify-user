const fastify = require('fastify')

const { test } = require('tap')
const { createPublicKey, generateKeyPairSync } = require('crypto')
const { createSigner } = require('fast-jwt')
const fastifyUser = require('..')

// creates a RSA key pair for the test
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
})
const jwtPublicKey = createPublicKey(publicKey).export({ format: 'jwk' })

async function buildJwksEndpoint (jwks, fail = false) {
  const app = fastify()
  app.get('/.well-known/jwks.json', async (request, reply) => {
    if (fail) {
      throw Error('JWKS ENDPOINT ERROR')
    }
    return jwks
  })
  await app.listen({ port: 0 })
  return app
}

test('JWT verify OK using shared secret', async ({ same, teardown }) => {
  const payload = {
    'USER-ID': 42
  }

  const app = fastify()

  teardown(app.close.bind(app))

  app.register(fastifyUser, {
    jwt: {
      secret: 'supersecret'
    }
  })

  app.get('/', async function (request, reply) {
    return request.user
  })

  await app.ready()

  const token = await app.jwt.sign(payload)

  const response = await app.inject({
    method: 'GET',
    url: '/',
    headers: {
      Authorization: `Bearer ${token}`
    }
  })

  same(response.statusCode, 200)
  same(response.json(), {
    'USER-ID': 42
  })
})

test('JWT verify OK getting public key from jwks endpoint', async ({ same, teardown }) => {
  const { n, e, kty } = jwtPublicKey
  const kid = 'TEST-KID'
  const alg = 'RS256'
  const jwksEndpoint = await buildJwksEndpoint(
    {
      keys: [
        {
          alg,
          kty,
          n,
          e,
          use: 'sig',
          kid
        }
      ]
    }
  )
  const issuer = `http://localhost:${jwksEndpoint.server.address().port}`
  const header = {
    kid,
    alg,
    typ: 'JWT'
  }
  const payload = {
    'USER-ID': 42
  }

  const app = fastify()

  teardown(app.close.bind(app))
  teardown(() => jwksEndpoint.close())

  app.register(fastifyUser, {
    jwt: {
      jwks: true
    }
  })

  app.get('/', async function (request, reply) {
    return request.user
  })

  await app.ready()

  const signSync = createSigner({
    algorithm: 'RS256',
    key: privateKey,
    header,
    iss: issuer,
    kid
  })
  const token = signSync(payload)

  const response = await app.inject({
    method: 'GET',
    url: '/',
    headers: {
      Authorization: `Bearer ${token}`
    }
  })

  same(response.statusCode, 200)
  same(response.json(), {
    'USER-ID': 42
  })
})

test('jwt verify fails if getting public key from jwks endpoint fails', async ({ pass, teardown, same, equal }) => {
  const kid = 'TEST-KID'
  const alg = 'RS256'
  // This fails
  const jwksEndpoint = await buildJwksEndpoint(
    {}, true
  )
  const issuer = `http://localhost:${jwksEndpoint.server.address().port}`
  const header = {
    kid,
    alg,
    typ: 'JWT'
  }
  const payload = {
    'USER-ID': 42
  }

  const app = fastify()

  teardown(app.close.bind(app))
  teardown(() => jwksEndpoint.close())

  app.register(fastifyUser, {
    jwt: {
      jwks: true
    }
  })

  app.get('/', async function (request, reply) {
    return request.user
  })

  await app.ready()

  const signSync = createSigner({
    algorithm: 'RS256',
    key: privateKey,
    header,
    iss: issuer,
    kid
  })
  const token = signSync(payload)

  const res = await app.inject({
    method: 'GET',
    url: '/',
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
  // 500 is correct because the JWKS endpoint is failing
  // so we cannot verify the token
  equal(res.statusCode, 500)
  same(res.json(), {
    statusCode: 500,
    code: 'JWKS_REQUEST_FAILED',
    error: 'Internal Server Error',
    message: 'JWKS request failed'
  })
})

test('jwt verify fail if jwks succeed but kid is not found', async ({ pass, teardown, same, equal }) => {
  const { n, e, kty } = jwtPublicKey
  const kid = 'TEST-KID'
  const alg = 'RS256'

  const jwksEndpoint = await buildJwksEndpoint(
    {
      keys: [
        {
          alg,
          kty,
          n,
          e,
          use: 'sig',
          kid
        }
      ]
    }
  )

  const issuer = `http://localhost:${jwksEndpoint.server.address().port}`
  const header = {
    kid: 'DIFFERENT_KID',
    alg,
    typ: 'JWT'
  }
  const payload = {
    'USER-ID': 42
  }

  const app = fastify()

  app.register(fastifyUser, {
    jwt: {
      jwks: true
    }
  })

  app.get('/', async function (request, reply) {
    return request.user
  })

  teardown(app.close.bind(app))
  teardown(() => jwksEndpoint.close())

  await app.ready()

  const signSync = createSigner({
    algorithm: 'RS256',
    key: privateKey,
    header,
    iss: issuer,
    kid
  })
  const token = signSync(payload)

  const res = await app.inject({
    method: 'GET',
    url: '/',
    headers: {
      Authorization: `Bearer ${token}`
    }
  })

  equal(res.statusCode, 500)
  same(res.json(), {
    statusCode: 500,
    code: 'JWK_NOT_FOUND',
    error: 'Internal Server Error',
    message: 'No matching JWK found in the set.'
  })
})

test('jwt verify fails if the domain is not allowed', async ({ pass, teardown, same, equal }) => {
  const { n, e, kty } = jwtPublicKey
  const kid = 'TEST-KID'
  const alg = 'RS256'

  const jwksEndpoint = await buildJwksEndpoint(
    {
      keys: [
        {
          alg,
          kty,
          n,
          e,
          use: 'sig',
          kid
        }
      ]
    }
  )

  const issuer = `http://localhost:${jwksEndpoint.server.address().port}`
  const header = {
    kid,
    alg,
    typ: 'JWT'
  }
  const payload = {
    'USER-ID': 42
  }

  const app = fastify()

  app.register(fastifyUser, {
    jwt: {
      jwks: {
        allowedDomains: ['http://myalloawedomain.com']
      }
    }
  })

  app.get('/', async function (request, reply) {
    return request.user
  })

  teardown(app.close.bind(app))
  teardown(() => jwksEndpoint.close())

  await app.ready()

  const signSync = createSigner({
    algorithm: 'RS256',
    key: privateKey,
    header,
    iss: issuer,
    kid
  })
  const token = signSync(payload)

  const res = await app.inject({
    method: 'GET',
    url: '/',
    headers: {
      Authorization: `Bearer ${token}`
    }
  })

  equal(res.statusCode, 500)
  same(res.json(), {
    statusCode: 500,
    code: 'DOMAIN_NOT_ALLOWED',
    error: 'Internal Server Error',
    message: 'The domain is not allowed.'
  })
})

test('jwt skips namespace in custom claims', async ({ pass, teardown, same, equal }) => {
  const { n, e, kty } = jwtPublicKey
  const kid = 'TEST-KID'
  const alg = 'RS256'
  const jwksEndpoint = await buildJwksEndpoint(
    {
      keys: [
        {
          alg,
          kty,
          n,
          e,
          use: 'sig',
          kid
        }
      ]
    }
  )
  const issuer = `http://localhost:${jwksEndpoint.server.address().port}`
  const header = {
    kid,
    alg,
    typ: 'JWT'
  }
  const namespace = 'https://test.com/'
  const payload = {
    [`${namespace}USER-ID`]: 42
  }

  const app = fastify()

  app.register(fastifyUser, {
    jwt: {
      jwks: true,
      namespace
    }
  })

  app.get('/', async function (request, reply) {
    return request.user
  })

  teardown(app.close.bind(app))
  teardown(() => jwksEndpoint.close())

  await app.ready()

  const signSync = createSigner({
    algorithm: 'RS256',
    key: privateKey,
    header,
    iss: issuer,
    kid
  })
  const token = signSync(payload)

  const response = await app.inject({
    method: 'GET',
    url: '/',
    headers: {
      Authorization: `Bearer ${token}`
    }
  })

  same(response.statusCode, 200)
  same(response.json(), {
    'USER-ID': 42
  })
})
