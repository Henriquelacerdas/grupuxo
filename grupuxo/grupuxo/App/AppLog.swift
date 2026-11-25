//
//  AppLog.swift
//  grupuxo
//

import os

/// Registro de diagnóstico do app (Console do Mac / `log stream`), no lugar de `print`. O texto é privado por padrão:
/// em aparelhos de usuários aparece como `<private>`, e erros de login nunca vão para a saída padrão.
enum AppLog {
    private static let logger = Logger(subsystem: "henrique.grupuxo", category: "app")

    static func debug(_ message: String) {
        logger.debug("\(message, privacy: .private)")
    }

    static func error(_ message: String) {
        logger.error("\(message, privacy: .private)")
    }
}
