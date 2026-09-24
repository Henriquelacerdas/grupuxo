import SwiftUI

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
        }
    }

    var label: String {
        switch self {
        case .red: "Vermelho"
        case .orange: "Laranja"
        case .yellow: "Amarelo"
        case .green: "Verde"
        case .blue: "Azul"
        case .purple: "Roxo"
        case .brown: "Marrom"
        case .gray: "Cinza"
        case .pink: "Rosa"
        }
    }
}

struct RoomIconView: View {
    let appearance: RoomAppearance
    var size: CGFloat = 85

    var body: some View {
        Image(systemName: appearance.icon)
            .font(.system(size: size * 0.47, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(appearance.color.tint.gradient, in: Circle())
            .shadow(color: appearance.color.tint.opacity(0.3), radius: 5, y: 3)
            .accessibilityHidden(true)
    }
}
