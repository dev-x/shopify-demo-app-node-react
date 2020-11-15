require('isomorphic-fetch');
const dotenv = require('dotenv');
dotenv.config();
const Koa = require('koa');
const next = require('next');
const { default: createShopifyAuth, verifyRequest } = require('koa-shopify-jwt-auth');
const { default: graphQLProxy } = require('@shopify/koa-shopify-graphql-proxy');
const { ApiVersion } = require('@shopify/koa-shopify-graphql-proxy');
const Router = require('koa-router');
const { receiveWebhook, registerWebhook } = require('@shopify/koa-shopify-webhooks');
const getSubscriptionUrl = require('./server/getSubscriptionUrl');

const port = parseInt(process.env.PORT, 10) || 3000;
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

/**
 * offline tokens management should be implemented via db, redis etc 
*/ 
const tokens = {};
function storeToken(shop, token) {
  tokens[shop] = token;
}
function getToken(shop) {
  console.log('TCL: getToken -> tokens', tokens);
  return typeof tokens[shop] === 'undefined' ? null : tokens[shop];
}

const {
  SHOPIFY_API_SECRET_KEY,
  SHOPIFY_API_KEY,
  HOST,
} = process.env;

app.prepare().then(() => {
  const server = new Koa();
  const router = new Router();
  server.keys = [SHOPIFY_API_SECRET_KEY];

  server.use(
    createShopifyAuth({
      apiKey: SHOPIFY_API_KEY,
      secret: SHOPIFY_API_SECRET_KEY,
      scopes: ['read_products', 'write_products'],
      async afterAuth(ctx) {
        const { shop, accessToken } = ctx.session;
        storeToken(shop, accessToken);
        const registration = await registerWebhook({
          address: `${HOST}/webhooks/products/create`,
          topic: 'PRODUCTS_CREATE',
          accessToken,
          shop,
          apiVersion: ApiVersion.July20
        });

        if (registration.success) {
          console.log('Successfully registered webhook!');
        } else {
          console.log('Failed to register webhook', registration.result);
        }
        await getSubscriptionUrl(ctx, accessToken, shop);
      }
    })
  );

  const webhook = receiveWebhook({ secret: SHOPIFY_API_SECRET_KEY });

  router.post('/webhooks/products/create', webhook, (ctx) => {
    console.log('received webhook: ', ctx.state.webhook);
  });

  server.use(async (ctx, next) => {
    if (ctx.path === '/charge') {
      // we could try to trust shopify domain from query to get related offline token
      // then make requests to get and activate related charge
      // ctx.query.charge_id
      // ctx.query.shop

      // then we should redirect to the app
      return ctx.redirect(`https://${ctx.query.shop}/admin/apps/${SHOPIFY_API_KEY}`);
    }
    await next();
  });

  /**
   * protect all router endpoints defined above this line, plus /verify_token and /graphql
   * now any frontend pages and assets are not protected
  */ 
  server.use(async (ctx, next) => {
    if (router.stack.some(item => {
      return item.path === ctx.path && item.methods.includes(ctx.method);
    }) || ctx.path === '/verify_token' || ctx.path === '/graphql' ) {
      console.log('TCL: ctx.path', ctx.path);
      await verifyRequest({
        secret: SHOPIFY_API_SECRET_KEY,
        getOfflineToken: getToken, // if the function returns null it will be redirected to auth flow
      })(ctx, next);
    } else {
      await next();
    }
  });

  server.use(graphQLProxy({ version: ApiVersion.July20 }));

  router.get('(.*)', async (ctx) => {
    await handle(ctx.req, ctx.res);
    ctx.respond = false;
    ctx.res.statusCode = 200;
  });

  server.use(router.allowedMethods());
  server.use(router.routes());

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
