import { referenceAuth } from '@aws-amplify/backend';

/**
 * Reaproveita o User Pool que já existe (login com Apple que já funciona).
 * Identity Pool e roles criados via AWS CLI só para o Amplify Gen 2 conseguir referenciar o pool.
 */
export const auth = referenceAuth({
    userPoolId: 'us-east-1_M9GpISkE3',
    userPoolClientId: '21gqeeehhmeufpipk84e3cc7tu',
    identityPoolId: 'us-east-1:1adc14a2-acf4-46c6-a0aa-8ee3c538d79f',
    authRoleArn: 'arn:aws:iam::580100736070:role/grupuxo-identity-authRole',
    unauthRoleArn: 'arn:aws:iam::580100736070:role/grupuxo-identity-unauthRole',
});
