# `tools/local-api`: a `api` e o Cognito na sua máquina

Para desenvolver e testar o web (`web/`) sem AWS. **Não é implantado.**

```sh
cd backend
npm run local-api          # http://127.0.0.1:4010 (PORT muda a porta)
```

- `/v1/*`: a mesma `createApiHandler` da Lambda, sobre os adaptadores em memória (o estado some ao reiniciar) e o `CognitoJwtVerifier` real, com uma chave RSA gerada na subida.
- `/cognito`: emulador da API JSON do Cognito (`SignUp`, `ConfirmSignUp`, `ResendConfirmationCode`, `InitiateAuth` com `USER_SRP_AUTH` e `REFRESH_TOKEN_AUTH`, `RespondToAuthChallenge`, `ForgotPassword`, `ConfirmForgotPassword`, `ChangePassword`, `RevokeToken`). Código de confirmação: sempre `123456`. Política de senha do pool (8+, maiúscula, minúscula, número e símbolo).
- `/__photos/<key>`: destino do `PUT` pré-assinado da foto.
- `/__test/clock` (`POST { "advanceMs" }`) adianta o relógio do servidor; `/__test/scheduled` roda os avisos agendados (virada de ciclo, resumo); `/__test/reset` zera tudo.

`LOCAL_TOKEN_TTL` (segundos, padrão 3600) encurta o access token para testar o refresh. O web aponta para cá com `REVEZA_API_BASE_URL=http://127.0.0.1:4010` e `COGNITO_ENDPOINT=http://127.0.0.1:4010/cognito` (`web/.env.example`).
