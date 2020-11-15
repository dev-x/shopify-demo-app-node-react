import App from 'next/app';
import Head from 'next/head';
import { AppProvider } from '@shopify/polaris';
import { Provider } from '@shopify/app-bridge-react';
import '@shopify/polaris/dist/styles.css';
import translations from '@shopify/polaris/locales/en.json';
import ApolloClient from 'apollo-boost';
import { ApolloProvider } from 'react-apollo';
import ClientRouter from '../components/ClientRouter';
import createApp from '@shopify/app-bridge';
import { Redirect } from '@shopify/app-bridge/actions';
import { getSessionToken } from '@shopify/app-bridge-utils';

let client;

class MyApp extends App {

  constructor(props) {
    super(props);
    this.state = {
      shopOrigin: null,
      error: false,
      token: null,      
    };
  }

  componentDidMount() {
    const url = new URL(window.location.href);
    const shopOrigin = this.state.shopOrigin || url.searchParams.get('shop');
    if (!shopOrigin) {
      this.setState({error: true});
      return;
    }
    (async () => {
      let lToken = null;
      if (window.top === window.self) {
        window.location.assign(`/auth?shop=${shopOrigin}`);
      } else {
        const app = createApp({
          apiKey: API_KEY,
          shopOrigin,
        });
        function redirect() {
          Redirect.create(app).dispatch(Redirect.Action.REMOTE, `${url.protocol}//${url.host}/auth?shop=${shopOrigin}`);          
        }
        // get session token
        lToken = await getSessionToken(app);
        if (!lToken) {
          redirect();
        } else {
          try {
            // it response ok if session token is ok and offline token is stored
            // if it's not ok we should redirect to auth flow to get offline token
            const resp = await fetch(`/verify_token?shop=${shopOrigin}&token=${lToken}`);
            if (resp.ok) {
              const data = await resp.json();
              if (data && data.status === 'ok') {
                client = new ApolloClient({
                  headers: {
                    authorization: `Bearer ${lToken}`
                  },
                });
                this.setState({
                  shopOrigin: shopOrigin,
                  token: lToken,
                });
              } else {
                redirect();
              }
            } else {
              redirect();
            }
          } catch (err) {
            redirect();
          }
        }
      }
    })();    
  }

  render() {
    const { Component, pageProps } = this.props;
    const { error, token, shopOrigin } = this.state;    

    if (error) {
      return null; // error message here
    }    

    if (token === null) {
      return null; // spinner here
    }

    const config = { apiKey: API_KEY, shopOrigin: shopOrigin, forceRedirect: true };

    return (
      <React.Fragment>
        <Head>
          <title>Sample App</title>
          <meta charSet="utf-8" />
        </Head>
        <Provider config={config}>
          <ClientRouter />
          <AppProvider i18n={translations}>
            <ApolloProvider client={client}>
              <Component {...pageProps} />
            </ApolloProvider>
          </AppProvider>
        </Provider>
      </React.Fragment>
    );
  }
}

export default MyApp;
