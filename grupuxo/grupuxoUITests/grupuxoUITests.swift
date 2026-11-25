//
//  grupuxoUITests.swift
//  grupuxoUITests
//
//  Created by Henrique Lacerda Silveira on 14/09/26.
//

import XCTest

/// Percurso de fumaça pelas telas principais na casa de demonstração (`-DemoHouse`, só Debug, sem servidor).
final class grupuxoUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func launchDemo(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-DemoHouse", "-AppleLanguages", "(pt-BR)", "-AppleLocale", "pt_BR"] + extra
        app.launch()
        return app
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testMainScreensOpen() throws {
        let app = launchDemo()
        XCTAssertTrue(app.staticTexts["Minhas tarefas"].waitForExistence(timeout: 10))
        capture(app, "Minhas tarefas")

        app.buttons["notifications"].tap()
        XCTAssertTrue(app.navigationBars["Notificações"].waitForExistence(timeout: 5))
        capture(app, "Notificações")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        app.buttons["profile"].tap()
        XCTAssertTrue(app.staticTexts["Ajustes"].waitForExistence(timeout: 5) || app.navigationBars["Ajustes"].waitForExistence(timeout: 5))
        capture(app, "Ajustes")
        app.buttons["Fechar"].firstMatch.tap()

        app.buttons["Casa"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Cômodos"].waitForExistence(timeout: 5))
        capture(app, "Casa")

        let room = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Banheiro")).firstMatch
        for _ in 0..<4 where !room.isHittable { app.swipeUp() }
        room.tap()
        XCTAssertTrue(app.navigationBars["Banheiro"].waitForExistence(timeout: 5))
        capture(app, "Banheiro")
    }

    @MainActor
    func testCreationSheetsOpenFromHouse() throws {
        let app = launchDemo()
        app.buttons["Casa"].firstMatch.tap()
        app.buttons["addMenu"].firstMatch.tap()
        app.descendants(matching: .any)["createTask"].firstMatch.tap()
        XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 5))
        capture(app, "Nova tarefa")
        app.buttons["Fechar"].firstMatch.tap()

        app.buttons["addMenu"].firstMatch.tap()
        app.descendants(matching: .any)["createRoom"].firstMatch.tap()
        XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 5))
        capture(app, "Novo cômodo")
    }

    @MainActor
    func testLargeDynamicTypeAndEnglish() throws {
        let app = launchDemo(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"])
        XCTAssertTrue(app.staticTexts["Minhas tarefas"].waitForExistence(timeout: 10))
        capture(app, "Minhas tarefas - texto ampliado")
        app.terminate()

        let english = XCUIApplication()
        english.launchArguments += ["-DemoHouse", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        english.launch()
        XCTAssertTrue(english.staticTexts["My tasks"].waitForExistence(timeout: 10))
        capture(english, "My tasks - English")
        XCTAssertTrue(english.buttons["House"].firstMatch.exists)
    }
}
