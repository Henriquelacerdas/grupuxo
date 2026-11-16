import Foundation

/// Modo férias do morador: ausência sem data de volta. Ligar vale a partir da próxima segunda ("do próximo ciclo"),
/// então `startsAt` pode ser futuro.
public struct VacationStatus: Equatable, Sendable {

    public let isOn: Bool
    public let startsAt: Date?

    public init(isOn: Bool, startsAt: Date? = nil) {
        self.isOn = isOn
        self.startsAt = startsAt
    }

    public static let off = VacationStatus(isOn: false)

    /// Ligado, mas ainda não começou (começa no próximo ciclo).
    public func hasNotStarted(at date: Date) -> Bool {
        guard isOn, let startsAt else { return false }
        return startsAt > date
    }
}
