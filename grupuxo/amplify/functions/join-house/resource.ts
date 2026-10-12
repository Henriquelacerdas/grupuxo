import { defineFunction } from '@aws-amplify/backend';

export const joinHouse = defineFunction({
    name: 'join-house',
    entry: './handler.ts',
    timeoutSeconds: 20,
});
