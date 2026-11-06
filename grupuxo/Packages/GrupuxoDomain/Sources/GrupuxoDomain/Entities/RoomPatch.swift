import Foundation

/// Campos de um cômodo que o morador pode mudar (`PATCH /v1/rooms/{id}`); o que fica `nil` não muda.
public struct RoomPatch: Equatable, Sendable {

    public var name: String?
    public var category: RoomCategory?
    public var icon: String?
    public var color: RoomColor?
    public var periodicity: WeeklyPeriodicity?
    public var responsibleCount: Int?

    public init(
        name: String? = nil,
        category: RoomCategory? = nil,
        icon: String? = nil,
        color: RoomColor? = nil,
        periodicity: WeeklyPeriodicity? = nil,
        responsibleCount: Int? = nil
    ) {
        self.name = name
        self.category = category
        self.icon = icon
        self.color = color
        self.periodicity = periodicity
        self.responsibleCount = responsibleCount
    }

    public var isEmpty: Bool {
        name == nil && category == nil && icon == nil && color == nil && periodicity == nil && responsibleCount == nil
    }
}
