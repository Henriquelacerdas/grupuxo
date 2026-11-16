//
//  AppBootstrap.swift
//  grupuxo
//

import Amplify
import AWSCognitoAuthPlugin

/// Configuração que precisa existir tanto quando o app abre pela tela quanto quando o iOS
/// o acorda em segundo plano só para rodar um atalho. Chamar mais de uma vez é seguro.
@MainActor
enum AppBootstrap {

    private static var isAmplifyConfigured = false

    static func configureAmplifyIfNeeded() {
        guard !isAmplifyConfigured else { return }
        do {
            // Só o Auth do Amplify (login com Cognito); casa, cômodos e tarefas vêm da `api` do servidor.
            try Amplify.add(plugin: AWSCognitoAuthPlugin())
            try Amplify.configure(with: .amplifyOutputs)
            isAmplifyConfigured = true
            print("Amplify configurado")
        } catch {
            print("Erro ao configurar Amplify: \(error)")
        }
    }
}
