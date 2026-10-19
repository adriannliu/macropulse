import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

/**
 * AWS Amplify Gen 2 Backend Definition
 * Provisions AWS Cognito User Pool and Amazon DynamoDB Tables
 */
export const backend = defineBackend({
  auth,
  data,
});
