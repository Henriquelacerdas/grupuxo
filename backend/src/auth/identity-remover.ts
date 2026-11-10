/**
 * Apaga o usuário do user pool do Cognito. Quem chama passa o `username` do próprio access token
 * (`VerifiedToken.username`, ou o `sub` quando o token não o traz): nunca um valor vindo do corpo ou da URL.
 * Idempotente: usuário que já não existe conta como feito. Qualquer outra falha é exceção de mensagem fixa.
 *
 * O servidor faz isso (e não o app, com `Amplify.Auth.deleteUser`) porque o `DeleteUser` do Cognito exige o escopo
 * `aws.cognito.signin.user.admin`, que o login com a Apple (Hosted UI) não traz.
 */
export interface IdentityRemover {
  deleteIdentity(username: string): Promise<void>;
}
