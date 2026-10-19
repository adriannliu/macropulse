import { defineAuth, secret } from '@aws-amplify/backend';

/**
 * AWS Cognito User Pool with Email + Google OAuth
 * Conditionally activates Google external provider if credentials are configured
 */
const hasGoogleCreds = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

export const auth = defineAuth({
  loginWith: {
    email: true,
    ...(hasGoogleCreds
      ? {
          externalProviders: {
            google: {
              clientId: secret('GOOGLE_CLIENT_ID'),
              clientSecret: secret('GOOGLE_CLIENT_SECRET'),
              scopes: ['email', 'profile', 'openid'],
              attributeMapping: {
                email: 'email',
              },
            },
            callbackUrls: [
              'http://localhost:5173/',
              'https://main.*.amplifyapp.com/',
            ],
            logoutUrls: [
              'http://localhost:5173/',
              'https://main.*.amplifyapp.com/',
            ],
          },
        }
      : {}),
  },
  userAttributes: {
    email: {
      required: true,
      mutable: true,
    },
  },
});
