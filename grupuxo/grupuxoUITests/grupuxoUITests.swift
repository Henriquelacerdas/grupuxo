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
        app.tabBars.buttons["Casa"].tap()
        app.buttons["Cozinha"].tap()
        XCTAssertTrue(app.buttons["Concluir Lavar a louça"].waitForExistence(timeout: 5))
        app.buttons["Concluir Lavar a louça"].tap()
        XCTAssertTrue(app.staticTexts["Concluída"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            XCUIApplication().launch()
        }
    }
}
