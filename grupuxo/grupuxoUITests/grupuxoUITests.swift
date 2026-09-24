//
//  grupuxoUITests.swift
//  grupuxoUITests
//
//  Created by Henrique Lacerda Silveira on 14/09/26.
//

import XCTest

final class grupuxoUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    @MainActor
    func testResidentsAndRoomCompletionControls() throws {
        let app = XCUIApplication()
        app.launch()
        app.buttons["Perfil"].tap()
        for name in ["Marina", "Leo", "Bia", "Rafa"] {
            XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 5))
        }
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tabBars.buttons["Casa"].tap()
        app.buttons["Casa toda"].tap()
        XCTAssertFalse(app.buttons["Sair do cômodo"].exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tabBars.buttons["Tarefas"].tap()
        let complete = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Concluir ")).firstMatch
        XCTAssertTrue(complete.waitForExistence(timeout: 5))
        complete.tap()

    }

    @MainActor
    func testAddAndRemoveResidentFromProfile() throws {
        let app = XCUIApplication()
        app.launch()
        app.buttons["Perfil"].tap()
        app.buttons["Adicionar morador"].tap()
        let name = app.textFields["Nome"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Adicionar"].isEnabled)
        name.tap()
        name.typeText("Joana")
        app.buttons["Adicionar"].tap()
        XCTAssertTrue(app.staticTexts["Joana"].waitForExistence(timeout: 5))
        app.buttons["Remover Joana da casa"].tap()
        app.buttons["Cancelar"].tap()
        XCTAssertTrue(app.staticTexts["Joana"].exists)
        app.buttons["Remover Joana da casa"].tap()
        app.buttons["Remover da casa"].tap()
        XCTAssertTrue(app.staticTexts["Joana"].waitForNonExistence(timeout: 5))
    }

    @MainActor
    func testPrivateRoomJoinLeaveAndConfirmedDeletion() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        app.launch()
        app.tabBars.buttons["Casa"].tap()
        app.buttons["Adicionar cômodo"].tap()
        let field = app.textFields["Nome do cômodo"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Quarto teste")
        field.typeText("\n")
        let privacy = app.switches["Cômodo Privado"]
        for _ in 0..<8 {
            if privacy.isHittable && privacy.frame.maxY < app.frame.maxY - 100 { break }
            app.swipeUp()
        }
        privacy.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(privacy.value as? String, "1")
        let editorCapture = XCTAttachment(screenshot: app.screenshot())
        editorCapture.name = "Privacidade com texto ampliado"
        editorCapture.lifetime = .keepAlways
        add(editorCapture)
        app.buttons["saveRoom"].tap()
        let room = app.buttons["Quarto teste"]
        if !room.isHittable { app.swipeUp() }
        XCTAssertTrue(room.waitForExistence(timeout: 5))
        room.tap()
        let leave = app.buttons["Sair do cômodo"]
        for _ in 0..<5 where !leave.isHittable { app.swipeUp() }
        let detailCapture = XCTAttachment(screenshot: app.screenshot())
        detailCapture.name = "Detalhe antes de sair"
        detailCapture.lifetime = .keepAlways
        add(detailCapture)
        leave.tap()
        let warning = app.alerts["Sair e excluir cômodo?"]
        XCTAssertTrue(warning.waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Confirmacao ultima saida - Dynamic Type"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        warning.buttons["Cancelar"].tap()
        XCTAssertTrue(app.buttons["Sair do cômodo"].exists)
        app.buttons["Sair do cômodo"].tap()
        warning.buttons["Sair e excluir"].tap()
        XCTAssertTrue(room.waitForNonExistence(timeout: 5))
        let office = app.buttons["Escritório privado"]
        for _ in 0..<4 where !office.isHittable { app.swipeUp() }
        office.tap()
        app.buttons["Sair do cômodo"].tap()
        XCTAssertTrue(app.buttons["Entrar no cômodo"].waitForExistence(timeout: 5))
        app.buttons["Entrar no cômodo"].tap()
        XCTAssertTrue(app.buttons["Sair do cômodo"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testSeparateCreationActionsAndRoomAppearance() throws {
        let app = XCUIApplication()
        app.launch()
        app.tabBars.buttons["Casa"].tap()
        app.buttons["createTask"].tap()
        XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Novo Cômodo"].exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["createRoom"].tap()
        XCTAssertTrue(app.navigationBars["Novo Cômodo"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["saveRoom"].isEnabled)
        app.buttons["Roxo"].tap()
        app.buttons["Quarto"].tap()
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Novo cômodo - cor e ícone"
        attachment.lifetime = .keepAlways
        add(attachment)
        let field = app.textFields["Nome do cômodo"]
        field.tap()
        field.typeText("Quarto violeta")
        app.buttons["saveRoom"].tap()
        let room = app.buttons["Quarto violeta"]
        for _ in 0..<5 where !room.isHittable { app.swipeUp() }
        XCTAssertTrue(room.waitForExistence(timeout: 5))
        room.tap()
        XCTAssertTrue(app.navigationBars["Quarto violeta"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            XCUIApplication().launch()
        }
    }
}
