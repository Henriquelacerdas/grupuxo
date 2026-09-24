import Foundation
import Testing
@testable import grupuxo

struct RoomAppearanceTests {
    @Test @MainActor func editorSavesAppearanceAndSelectedResidents() async throws {
        let store = MockStore()
        let container = AppContainer(store: store)
        let members = try await container.houseRepository.members(in: MockSeed.house.id)
        let creator = try #require(members.first)
        let second = try #require(members.dropFirst().first)
        let model = RoomEditorViewModel(
            createRoom: CreateRoomUseCase(roomRepository: container.roomRepository, houseRepository: container.houseRepository),
            houseID: MockSeed.house.id, creatorUserID: creator.id,
            getMembers: GetHouseMembersUseCase(repository: container.houseRepository)
        )
        #expect(!model.canSave)
        await model.loadResidents()
        #expect(model.residents.count == members.count)
        model.updateDraft {
            $0.name = "  Quarto azul  "
            $0.icon = "bed.double.fill"
            $0.color = .purple
            $0.visibility = .privateRoom
            $0.selectedParticipantIDs.insert(second.id)
        }
        await model.save()
        guard case let .saved(room) = model.state else {
            Issue.record("Expected a saved room, got \(model.state)")
            return
        }
        let stored = try await container.roomRepository.room(id: room.id, requesting: creator.id)
        #expect(stored.name == "Quarto azul")
        #expect(stored.icon == "bed.double.fill")
        #expect(stored.color == .purple)
        let participation = try await container.roomRepository.participation(in: room.id, requesting: second.id, at: .now)
        #expect(participation.isMember)
        #expect(participation.memberCount == 2)
    }

    @Test @MainActor func privateRoomStartsWithOnlyCreator() async throws {
        let container = AppContainer(store: MockStore())
        let model = RoomEditorViewModel(
            createRoom: CreateRoomUseCase(roomRepository: container.roomRepository, houseRepository: container.houseRepository),
            houseID: MockSeed.house.id, creatorUserID: MockSeed.currentUser.id,
            getMembers: GetHouseMembersUseCase(repository: container.houseRepository)
        )
        await model.loadResidents()
        model.updateDraft { $0.name = "Quarto"; $0.visibility = .privateRoom }
        await model.save()
        guard case let .saved(room) = model.state else { Issue.record("Room not saved"); return }
        let info = try await container.roomRepository.participation(in: room.id, requesting: MockSeed.currentUser.id, at: .now)
        #expect(info.memberCount == 1)
        #expect(info.isMember)
    }

    @Test func olderRoomsDecodeWithLegacyAppearance() throws {
        let data = try JSONEncoder().encode(MockSeed.kitchen)
        var json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        json.removeValue(forKey: "icon")
        json.removeValue(forKey: "color")
        json["appearance"] = ["icon": "bed.double.fill", "color": "purple"]
        let decoded = try JSONDecoder().decode(Room.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(decoded.icon == "bed.double.fill")
        #expect(decoded.color == .purple)
        #expect(decoded.name == MockSeed.kitchen.name)
    }

    @Test func mockedRoomsHaveDistinctIconsAndColors() {
        let rooms = MockSeed.rooms
        #expect(Set(rooms.map(\.icon)).count == rooms.count)
        #expect(Set(rooms.map(\.color)).count == rooms.count)
    }
}
