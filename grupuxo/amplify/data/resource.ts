import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { joinHouse } from '../functions/join-house/resource';

/**
 * Autorização por morador da casa (e não por "qualquer usuário logado").
 *
 * Cada registro carrega `members`: os `sub` do Cognito dos moradores com conta da casa. A regra
 * `ownersDefinedIn('members')` com `identityClaim('sub')` libera ler/gravar só a quem está nessa lista.
 * O AppSync não faz "join" entre modelos, então a lista é replicada em todos os registros da casa
 * (casa, cômodos, moradores e código de convite). Quem entra pelo código não consegue se acrescentar
 * sozinho (ainda não é dono de nada): isso é feito pela função `joinHouse`, que roda com IAM.
 *
 * Amplify Data é a camada transitória do fluxo de casa/convite; a fonte da verdade da casa é o backend
 * TypeScript (docs/BACKEND.md). Quando o app passar a usar a `api`, estes modelos saem.
 */
const schema = a
    .schema({
        HouseRecord: a
            .model({
                name: a.string().required(),
                ownerId: a.string().required(),
                members: a.string().required().array().required(),
            })
            .authorization((allow) => [allow.ownersDefinedIn('members').identityClaim('sub')]),

        RoomRecord: a
            .model({
                houseId: a.id().required(),
                name: a.string().required(),
                members: a.string().required().array().required(),
            })
            .secondaryIndexes((index) => [index('houseId')])
            .authorization((allow) => [allow.ownersDefinedIn('members').identityClaim('sub')]),

        MemberRecord: a
            .model({
                houseId: a.id().required(),
                userId: a.string(), // vazio = morador adicionado manualmente, sem conta
                name: a.string().required(),
                role: a.string().required(), // mantido por compatibilidade; sempre "MEMBER"
                members: a.string().required().array().required(),
            })
            .secondaryIndexes((index) => [index('houseId'), index('userId')])
            .authorization((allow) => [allow.ownersDefinedIn('members').identityClaim('sub')]),

        /**
         * Código de convite. O `id` é o próprio código, então o AppSync recusa criar um código que já existe
         * (a unicidade vale mesmo com criações simultâneas). Só os moradores da casa leem; quem ainda não
         * é morador resolve o código pela mutation `joinHouse`.
         */
        InviteCode: a
            .model({
                houseId: a.id().required(),
                members: a.string().required().array().required(),
            })
            .secondaryIndexes((index) => [index('houseId')])
            .authorization((allow) => [allow.ownersDefinedIn('members').identityClaim('sub')]),

        /** Entra na casa pelo código: valida, acrescenta o chamador a `members` em todos os registros e cria o morador. */
        joinHouse: a
            .mutation()
            .arguments({
                code: a.string().required(),
                memberName: a.string().required(),
            })
            .returns(a.ref('HouseRecord'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(joinHouse)),
    })
    .authorization((allow) => [allow.resource(joinHouse)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
    schema,
    authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
