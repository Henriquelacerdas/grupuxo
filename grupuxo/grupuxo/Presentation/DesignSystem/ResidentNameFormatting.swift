import Foundation

enum ResidentNameFormatting {

    /// "Julia Carvalho" vira "Julia C."; nomes sem sobrenome ficam como estão.
    static func shortName(_ fullName: String) -> String {

        let trimmed = fullName.trimmingCharacters(in: .whitespacesAndNewlines)

        guard
            let components = PersonNameComponentsFormatter()
                .personNameComponents(from: trimmed),
            let given = components.givenName,
            let family = components.familyName?.first
        else {
            return trimmed
        }

        return "\(given) \(family)."
    }
}
