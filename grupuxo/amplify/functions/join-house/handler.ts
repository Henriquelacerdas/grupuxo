import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/join-house';
import type { Schema } from '../../data/resource';
import { INVALID_INVITE_CODE, normalizeCode, withMember } from './members';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>({ authMode: 'iam' });

/** Pagina uma listagem inteira (uma casa tem poucos cômodos e moradores). */
async function all<T>(
    page: (nextToken: string | null) => Promise<{ data: T[]; nextToken?: string | null; errors?: readonly { message: string }[] }>,
): Promise<T[]> {
    const items: T[] = [];
    let nextToken: string | null = null;
    do {
        const result = await page(nextToken);
        if (result.errors?.length) throw new Error(result.errors[0]?.message ?? 'Falha ao listar.');
        items.push(...result.data);
        nextToken = result.nextToken ?? null;
    } while (nextToken);
    return items;
}

function check(result: { errors?: readonly { message: string }[] }): void {
    if (result.errors?.length) throw new Error(result.errors[0]?.message ?? 'Falha ao gravar.');
}

export const handler: Schema['joinHouse']['functionHandler'] = async (event) => {
    const identity = event.identity;
    const sub = identity !== null && identity !== undefined && 'sub' in identity ? identity.sub : undefined;
    if (!sub) throw new Error('Não autenticado.');

    const code = normalizeCode(event.arguments.code);
    const memberName = event.arguments.memberName.trim();
    if (!code || !memberName) throw new Error(INVALID_INVITE_CODE);

    const invite = await client.models.InviteCode.get({ id: code });
    check(invite);
    if (!invite.data) throw new Error(INVALID_INVITE_CODE);

    const houseResult = await client.models.HouseRecord.get({ id: invite.data.houseId });
    check(houseResult);
    const house = houseResult.data;
    if (!house) throw new Error(INVALID_INVITE_CODE);

    const members = withMember(house.members, sub);
    if (members === house.members) return house; // já é morador: repetir não muda nada

    const houseId = house.id;
    const rooms = await all((nextToken) => client.models.RoomRecord.listRoomRecordByHouseId({ houseId }, { nextToken }));
    const residents = await all((nextToken) => client.models.MemberRecord.listMemberRecordByHouseId({ houseId }, { nextToken }));

    // Primeiro tudo o que depende de `members`; a casa por último, porque é ela que dá o acesso ao novo morador.
    // Se algo falhar no meio, a casa ainda não tem o novo `sub` e repetir a chamada refaz os passos que faltam.
    check(await client.models.InviteCode.update({ id: invite.data.id, members }));
    for (const room of rooms) check(await client.models.RoomRecord.update({ id: room.id, members }));
    for (const resident of residents) check(await client.models.MemberRecord.update({ id: resident.id, members }));

    if (!residents.some((resident) => resident.userId === sub)) {
        check(await client.models.MemberRecord.create({ houseId, userId: sub, name: memberName, role: 'MEMBER', members }));
    }

    const updated = await client.models.HouseRecord.update({ id: houseId, members });
    check(updated);
    if (!updated.data) throw new Error('Falha ao entrar na casa.');
    return updated.data;
};
