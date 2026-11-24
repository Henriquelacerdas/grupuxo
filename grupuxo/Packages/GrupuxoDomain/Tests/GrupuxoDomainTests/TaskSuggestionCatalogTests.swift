import Testing
@testable import GrupuxoDomain

struct TaskSuggestionCatalogTests {
    @Test func everyCategoryHasManyUniqueSuggestions() {
        let catalog = TaskSuggestionCatalog()
        for category in RoomCategory.allCases {
            let items = catalog.suggestions(for: category)
            #expect(items.count >= 10, "\(category) tem \(items.count)")
            #expect(Set(items.map(\.id)).count == items.count, "ids repetidos em \(category)")
            #expect(Set(items.map(\.name)).count == items.count, "nomes repetidos em \(category)")
            #expect(items.allSatisfy { $0.id.hasPrefix("\(category.rawValue).") })
        }
    }
}
