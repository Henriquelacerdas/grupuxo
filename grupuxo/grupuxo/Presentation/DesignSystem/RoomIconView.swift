import Foundation
import SwiftUI
import GrupuxoDomain

extension RoomColor {
    var tint: Color {
        switch self {
        case .red: .red
        case .orange: .orange
        case .yellow: .yellow
        case .green: .green
        case .blue: .blue
        case .purple: .purple
        case .brown: .brown
        case .gray: .gray
        case .pink: .pink
        case .teal: .teal
        case .indigo: .indigo
        case .cyan: .cyan
        }
    }

    var label: String {
        switch self {
        case .red: String(localized: "Vermelho")
        case .orange: String(localized: "Laranja")
        case .yellow: String(localized: "Amarelo")
        case .green: String(localized: "Verde")
        case .blue: String(localized: "Azul")
        case .purple: String(localized: "Roxo")
        case .brown: String(localized: "Marrom")
        case .gray: String(localized: "Cinza")
        case .pink: String(localized: "Rosa")
        case .teal: String(localized: "Azul-petróleo")
        case .indigo: String(localized: "Índigo")
        case .cyan: String(localized: "Ciano")
        }
    }
}

struct RoomIconView: View {
    let icon: String
    let color: RoomColor
    var size: CGFloat = 85

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: size * 0.47, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(color.tint.gradient, in: Circle())
            .shadow(color: color.tint.opacity(0.3), radius: 5, y: 3)
            .accessibilityHidden(true)
    }
}
