import Foundation
import Testing
@testable import grupuxo

struct HouseMembershipTests {
    @Test func addsResidentWithOnlyTrimmedName() async throws {
        let store = MockStore()
        let repository = MockHouseRepository(store: store)
        let user = try await AddHouseMemberUseCase(repository: repository)(
            name: "  Nova Moradora \n", houseID: MockSeed.house.id, requestedBy: MockSeed.currentUser.id)
        #expect(user.name == "Nova Moradora")
        #expect(user.email == nil)
        #expect(try await repository.memberIDs(in: MockSeed.house.id).contains(user.id))
        let state = await store.read { $0 }
        let wholeHouseIDs = Set(state.rooms.filter { $0.houseID == MockSeed.house.id && $0.visibility == .common }.map(\.id))
        #expect(!state.roomMemberships.contains { $0.roomID == MockSeed.privateOffice.id && $0.userID == user.id })
        #expect(wholeHouseIDs.allSatisfy { roomID in
            state.roomMemberships.contains { $0.roomID == roomID && $0.userID == user.id && $0.isCurrent }
        })
    }

    @Test func rejectsBlankNameWithoutChangingMembers() async throws {
        let store = MockStore()
        let repository = MockHouseRepository(store: store)
        let before = try await repository.members(in: MockSeed.house.id)
        await #expect(throws: DomainError.invalidResidentName) {
            try await AddHouseMemberUseCase(repository: repository)(
                name: " \n ", houseID: MockSeed.house.id, requestedBy: MockSeed.currentUser.id)
        }
        #expect(try await repository.members(in: MockSeed.house.id) == before)
    }

    @Test func removalEndsRoomParticipationAndPreservesUserHistory() async throws {
        let store = MockStore()
        let repository = MockHouseRepository(store: store)
        let before = await store.read { $0 }
        let user = try #require(before.houseMemberships.first { $0.houseID == MockSeed.house.id && $0.userID != MockSeed.currentUser.id }?.userID)
        try await RemoveHouseMemberUseCase(repository: repository)(
            userID: user, houseID: MockSeed.house.id, requestedBy: MockSeed.currentUser.id)
        let after = await store.read { $0 }
        #expect(!after.houseMemberships.contains { $0.houseID == MockSeed.house.id && $0.userID == user })
        let rooms = Set(after.rooms.filter { $0.houseID == MockSeed.house.id }.map(\.id))
        #expect(!after.roomMemberships.contains { rooms.contains($0.roomID) && $0.userID == user && $0.isCurrent })
        #expect(after.users.contains { $0.id == user })
        #expect(before.occurrences.filter(\.isCompleted).allSatisfy { after.occurrences.contains($0) })
    }

    @Test func cannotRemoveOwnProfile() async throws {
        let repository = MockHouseRepository(store: MockStore())
        await #expect(throws: DomainError.cannotRemoveCurrentUser) {
            try await RemoveHouseMemberUseCase(repository: repository)(
                userID: MockSeed.currentUser.id, houseID: MockSeed.house.id, requestedBy: MockSeed.currentUser.id)
        }
        #expect(try await repository.memberIDs(in: MockSeed.house.id).contains(MockSeed.currentUser.id))
    }
}
