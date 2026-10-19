import { defineAuth } from '@aws-amplify/backend';

/**
 * AWS Cognito User Pool with Email + Google OAuth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        scopes: ['email', 'profile', 'openid'],
        attributeMapping: {
          email: 'email',
        },
      },
      callbackUrls: [
        'http://localhost:5173/',
        'https://main.*.amplifyapp.com/',
        'https://macropulse-six.vercel.app/',
      ],
      logoutUrls: [
        'http://localhost:5173/',
        'https://main.*.amplifyapp.com/',
        'https://macropulse-six.vercel.app/',
      ],
    },
  },
  userAttributes: {
    email: {
      required: true,
      mutable: true,
    },
  },
});
