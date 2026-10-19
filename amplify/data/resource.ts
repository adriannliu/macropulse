import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * DynamoDB Data Schema with Owner-based Row Level Security
 */
const schema = a.schema({
  UserProfile: a
    .model({
      sex: a.string().required(),
      weightKg: a.float().required(),
      heightCm: a.float().required(),
      age: a.integer().required(),
      activity: a.float().required(),
      goalDelta: a.float().required(),
    })
    .authorization((allow) => [allow.owner()]),

  DailyLog: a
    .model({
      date: a.string().required(), // 'YYYY-MM-DD'
      weightKg: a.float(),
      targetKcal: a.float(),
      targetP: a.float(),
      targetC: a.float(),
      targetF: a.float(),
      itemsJson: a.string().required(), // Serialized LoggedFood[]
      notes: a.string(),
    })
    .authorization((allow) => [allow.owner()]),

  CustomFood: a
    .model({
      name: a.string().required(),
      category: a.string().required(),
      p: a.float().required(),
      c: a.float().required(),
      f: a.float().required(),
      defaultGrams: a.float().required(),
    })
    .authorization((allow) => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
