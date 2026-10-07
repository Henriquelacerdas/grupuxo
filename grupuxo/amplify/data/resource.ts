import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

const schema = a.schema({
    HouseRecord: a.model({
        name: a.string().required(),
        inviteCode: a.string().required(),
        ownerId: a.string().required(),
    })
        .secondaryIndexes((index) => [index('inviteCode')])
        .authorization((allow) => [allow.authenticated()]),

    RoomRecord: a.model({
        houseId: a.id().required(),
        name: a.string().required(),
    })
        .secondaryIndexes((index) => [index('houseId')])
        .authorization((allow) => [allow.authenticated()]),

    MemberRecord: a.model({
        houseId: a.id().required(),
        userId: a.string(),            // vazio = morador adicionado manualmente, sem conta
        name: a.string().required(),
        role: a.string().required(),   // "ADMIN" ou "MEMBER"
    })
        .secondaryIndexes((index) => [index('houseId'), index('userId')])
        .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
    schema,
    authorizationModes: { defaultAuthorizationMode: 'userPool' },
});