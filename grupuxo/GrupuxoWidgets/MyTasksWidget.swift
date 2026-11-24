import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Timeline de Minhas Tarefas (A · Lista, M2 · Lista com prazo, D · Estado vazio)

struct MyTasksEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct MyTasksTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> MyTasksEntry {
        MyTasksEntry(date: .now, snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (MyTasksEntry) -> Void) {
        if context.isPreview {
            completion(MyTasksEntry(date: .now, snapshot: .placeholder))
            return
        }
        completion(MyTasksEntry(date: .now, snapshot: WidgetTaskStore.shared.loadSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MyTasksEntry>) -> Void) {
        let now = Date.now
        let snapshot = WidgetTaskStore.shared.loadSnapshot()
        let entry = MyTasksEntry(date: now, snapshot: snapshot)
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: now)
            ?? now.addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
    }
}

struct MyTasksWidget: Widget {
    let kind: String = WidgetTaskStore.widgetKind

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MyTasksTimelineProvider()) { entry in
            MyTasksWidgetEntryView(entry: entry)
                .containerBackground(Color(uiColor: .systemBackground), for: .widget)
        }
        .configurationDisplayName("Minhas tarefas")
        .description("Veja e conclua suas tarefas pendentes da casa.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryRectangular,
            .accessoryCircular,
        ])
    }
}

struct MyTasksWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MyTasksEntry

    var body: some View {
        switch family {
        case .systemSmall:
            smallListView
        case .systemMedium:
            mediumListView
        case .accessoryCircular:
            circularLockScreenView
        case .accessoryRectangular:
            rectangularLockScreenView
        default:
            mediumListView
        }
    }

    // MARK: - A · Lista (systemSmall) + D · Estado vazio

    @ViewBuilder
    private var smallListView: some View {
        switch entry.snapshot.status {
        case .notSignedIn:
            WidgetStatusView(
                icon: "person.crop.circle.badge.exclamationmark",
                title: String(localized: "Entre na conta"),
                subtitle: String(localized: "Abra o Reveza para ver suas tarefas.")
            )
            .widgetURL(WidgetSnapshot.defaultURL)

        case .noHouse:
            WidgetStatusView(
                icon: "house",
                title: String(localized: "Sem casa"),
                subtitle: String(localized: "Entre ou crie uma casa no Reveza.")
            )
            .widgetURL(WidgetSnapshot.defaultURL)

        case .ready:
            if entry.snapshot.tasks.isEmpty {
                WidgetEmptyDoneView()
                    .widgetURL(WidgetSnapshot.defaultURL)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .center) {
                        Text("\(entry.snapshot.tasks.count)")
                            .font(.system(size: 26, weight: .bold, design: .rounded))
                            .foregroundStyle(.primary)

                        Spacer(minLength: 4)

                        RoomBadgeStack(badges: distinctRoomBadges(from: entry.snapshot.tasks, limit: 3))
                    }

                    // A lista sobe para perto do cabeçalho; o espaço que sobra fica embaixo.
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(entry.snapshot.tasks.prefix(3))) { task in
                            HStack(spacing: 2) {
                                Button(intent: CompleteTaskFromWidgetIntent(occurrenceID: task.occurrenceID)) {
                                    CheckTarget(color: task.tintColor, circle: 22, side: 36)
                                }
                                .buttonStyle(.plain)

                                Link(destination: task.deepLinkURL) {
                                    Text(task.name)
                                        .font(.system(size: 14, weight: .regular))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }
                        }
                    }

                    Spacer(minLength: 0)
                }
                .widgetURL(WidgetSnapshot.defaultURL)
            }
        }
    }

    // MARK: - M2 · Lista com prazo (systemMedium) + D · Estado vazio

    @ViewBuilder
    private var mediumListView: some View {
        switch entry.snapshot.status {
        case .notSignedIn:
            WidgetStatusView(
                icon: "person.crop.circle.badge.exclamationmark",
                title: String(localized: "Abra o app e entre na sua conta"),
                subtitle: String(localized: "Suas tarefas aparecerão aqui automaticamente.")
            )
            .widgetURL(WidgetSnapshot.defaultURL)

        case .noHouse:
            WidgetStatusView(
                icon: "house",
                title: String(localized: "Você ainda não faz parte de uma casa"),
                subtitle: String(localized: "Crie ou entre em uma casa no Reveza.")
            )
            .widgetURL(WidgetSnapshot.defaultURL)

        case .ready:
            if entry.snapshot.tasks.isEmpty {
                WidgetEmptyDoneView()
                    .widgetURL(WidgetSnapshot.defaultURL)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .center, spacing: 8) {
                        RoomBadgeStack(badges: distinctRoomBadges(from: entry.snapshot.tasks, limit: 3))

                        Text("Minhas tarefas")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                        Spacer(minLength: 4)

                        Text("\(entry.snapshot.tasks.count)")
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .foregroundStyle(.primary)
                    }

                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(entry.snapshot.tasks.prefix(3))) { task in
                            HStack(spacing: 2) {
                                Button(intent: CompleteTaskFromWidgetIntent(occurrenceID: task.occurrenceID)) {
                                    CheckTarget(color: task.tintColor, circle: 22, side: 38)
                                }
                                .buttonStyle(.plain)

                                Link(destination: task.deepLinkURL) {
                                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                                        Text(task.name)
                                            .font(.system(size: 14, weight: .regular))
                                            .foregroundStyle(.primary)
                                            .lineLimit(1)

                                        Spacer(minLength: 4)

                                        if let deadline = WidgetDeadlineFormatter.format(dueAt: task.dueAt, now: entry.date) {
                                            Text(deadline.text)
                                                .font(.system(size: 13, weight: deadline.isUrgent ? .semibold : .regular))
                                                .foregroundStyle(deadline.isUrgent ? .primary : .secondary)
                                                .lineLimit(1)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.top, 4)

                    Spacer(minLength: 0)
                }
                .widgetURL(WidgetSnapshot.defaultURL)
            }
        }
    }

    // MARK: - Tela de Bloqueio (accessoryCircular / accessoryRectangular)

    private var circularLockScreenView: some View {
        ZStack {
            AccessoryWidgetBackground()
            if entry.snapshot.status == .ready {
                if entry.snapshot.tasks.isEmpty {
                    Image(systemName: "checkmark")
                        .font(.headline.weight(.bold))
                } else {
                    VStack(spacing: 0) {
                        Text("\(entry.snapshot.tasks.count)")
                            .font(.headline.weight(.bold))
                        Text("tarefas")
                            .font(.system(size: 9))
                    }
                }
            } else {
                Image(systemName: "house")
                    .font(.headline)
            }
        }
        .widgetURL(WidgetSnapshot.defaultURL)
    }

    private var rectangularLockScreenView: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: "checklist")
                Text("Minhas tarefas")
                    .fontWeight(.semibold)
            }
            .font(.caption)

            switch entry.snapshot.status {
            case .notSignedIn:
                Text("Entre na sua conta no app")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            case .noHouse:
                Text("Entre em uma casa no app")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            case .ready:
                if let first = entry.snapshot.tasks.first {
                    Text(first.name)
                        .font(.caption.weight(.medium))
                        .lineLimit(1)
                    if let subtitle = lockScreenSubtitle(for: first) {
                        Text(subtitle)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                } else {
                    Text("Tudo feito")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .widgetURL(WidgetSnapshot.defaultURL)
    }

    private func lockScreenSubtitle(for task: WidgetTaskItem) -> String? {
        var parts: [String] = []
        if let roomName = task.roomName, !roomName.isEmpty {
            parts.append(roomName)
        }
        if let deadline = WidgetDeadlineFormatter.format(dueAt: task.dueAt, now: entry.date) {
            parts.append(deadline.text)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// MARK: - Seleção de Cômodo e Widget de Cômodo (C1c · Número no canto e M5 · Cômodo + tarefas)

struct WidgetRoomEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Cômodo"
    static let defaultQuery = WidgetRoomEntityQuery()

    let id: UUID
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct WidgetRoomEntityQuery: EntityQuery {
    func entities(for identifiers: [UUID]) async throws -> [WidgetRoomEntity] {
        let rooms = WidgetTaskStore.shared.loadSnapshot().rooms
        return rooms
            .filter { identifiers.contains($0.id) }
            .map { WidgetRoomEntity(id: $0.id, name: $0.name) }
    }

    func suggestedEntities() async throws -> [WidgetRoomEntity] {
        let rooms = WidgetTaskStore.shared.loadSnapshot().rooms
        return rooms.map { WidgetRoomEntity(id: $0.id, name: $0.name) }
    }

    func defaultResult() async -> WidgetRoomEntity? {
        guard let first = WidgetTaskStore.shared.loadSnapshot().rooms.first else { return nil }
        return WidgetRoomEntity(id: first.id, name: first.name)
    }
}

struct SelectRoomWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Escolher cômodo"
    static let description = IntentDescription("Escolhe qual cômodo exibir no widget.")

    @Parameter(title: "Cômodo")
    var room: WidgetRoomEntity?
}

struct RoomTasksEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    let selectedRoom: WidgetRoomSummary?
}

struct RoomTasksTimelineProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> RoomTasksEntry {
        let placeholder = WidgetSnapshot.placeholder
        return RoomTasksEntry(date: .now, snapshot: placeholder, selectedRoom: placeholder.rooms.first)
    }

    func snapshot(for configuration: SelectRoomWidgetIntent, in context: Context) async -> RoomTasksEntry {
        if context.isPreview {
            let placeholder = WidgetSnapshot.placeholder
            return RoomTasksEntry(date: .now, snapshot: placeholder, selectedRoom: placeholder.rooms.first)
        }
        let snapshot = WidgetTaskStore.shared.loadSnapshot()
        return RoomTasksEntry(
            date: .now,
            snapshot: snapshot,
            selectedRoom: resolveRoom(in: snapshot, configuration: configuration)
        )
    }

    func timeline(for configuration: SelectRoomWidgetIntent, in context: Context) async -> Timeline<RoomTasksEntry> {
        let now = Date.now
        let snapshot = WidgetTaskStore.shared.loadSnapshot()
        let entry = RoomTasksEntry(
            date: now,
            snapshot: snapshot,
            selectedRoom: resolveRoom(in: snapshot, configuration: configuration)
        )
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: now)
            ?? now.addingTimeInterval(1800)
        return Timeline(entries: [entry], policy: .after(nextUpdate))
    }

    private func resolveRoom(in snapshot: WidgetSnapshot, configuration: SelectRoomWidgetIntent) -> WidgetRoomSummary? {
        if let selectedID = configuration.room?.id,
           let matched = snapshot.rooms.first(where: { $0.id == selectedID }) {
            return matched
        }
        if let firstWithPending = snapshot.rooms.first(where: { !$0.pendingTasks.isEmpty }) {
            return firstWithPending
        }
        return snapshot.rooms.first
    }
}

struct RoomTasksWidget: Widget {
    let kind: String = WidgetTaskStore.roomWidgetKind

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: SelectRoomWidgetIntent.self,
            provider: RoomTasksTimelineProvider()
        ) { entry in
            RoomTasksWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Cômodo")
        .description("Acompanhe o ciclo de um cômodo e conclua as tarefas dele.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
        ])
    }
}

struct RoomTasksWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: RoomTasksEntry

    var body: some View {
        switch family {
        case .systemSmall:
            smallRoomView
                .containerBackground(for: .widget) {
                    smallBackground
                }
        default:
            mediumRoomView
                .containerBackground(Color(uiColor: .systemBackground), for: .widget)
        }
    }

    @ViewBuilder
    private var smallBackground: some View {
        if entry.snapshot.status == .ready, let room = entry.selectedRoom, !room.pendingTasks.isEmpty {
            LinearGradient(
                colors: [
                    room.tintColor.opacity(0.26),
                    room.tintColor.opacity(0.06),
                    Color(uiColor: .systemBackground),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        } else {
            Color(uiColor: .systemBackground)
        }
    }

    // MARK: - C1c · Número no canto (systemSmall)

    @ViewBuilder
    private var smallRoomView: some View {
        switch entry.snapshot.status {
        case .notSignedIn:
            WidgetStatusView(
                icon: "person.crop.circle.badge.exclamationmark",
                title: String(localized: "Entre na conta"),
                subtitle: String(localized: "Abra o Reveza para ver suas tarefas.")
            )
            .widgetURL(WidgetSnapshot.defaultURL)

        case .noHouse:
            WidgetStatusView(
                icon: "house",
                title: String(localized: "Sem casa"),
                subtitle: String(localized: "Entre ou crie uma casa no Reveza.")
            )
            .widgetURL(WidgetSnapshot.defaultURL)

        case .ready:
            if let room = entry.selectedRoom {
                if room.pendingTasks.isEmpty {
                    WidgetEmptyDoneView()
                        .widgetURL(WidgetSnapshot.defaultURL)
                } else {
                    RoomSummaryBlockContent(room: room, now: entry.date)
                        .widgetURL(WidgetSnapshot.defaultURL)
                }
            } else {
                WidgetEmptyDoneView()
                    .widgetURL(WidgetSnapshot.defaultURL)
            }
        }
    }

    // MARK: - M5 · Cômodo + tarefas (systemMedium)

    @ViewBuilder
    private var mediumRoomView: some View {
        switch entry.snapshot.status {
        case .notSignedIn:
            WidgetStatusView(
                icon: "person.crop.circle.badge.exclamationmark",
                title: String(localized: "Abra o app e entre na sua conta"),
                subtitle: String(localized: "Suas tarefas aparecerão aqui automaticamente.")
            )
            .widgetURL(WidgetSnapshot.defaultURL)

        case .noHouse:
            WidgetStatusView(
                icon: "house",
                title: String(localized: "Você ainda não faz parte de uma casa"),
                subtitle: String(localized: "Crie ou entre em uma casa no Reveza.")
            )
            .widgetURL(WidgetSnapshot.defaultURL)

        case .ready:
            if let room = entry.selectedRoom {
                HStack(spacing: 14) {
                    RoomSummaryBlockContent(room: room, now: entry.date)
                        .padding(12)
                        .frame(width: 142)
                        .frame(maxHeight: .infinity)
                        .background(
                            LinearGradient(
                                colors: [
                                    room.tintColor.opacity(0.26),
                                    room.tintColor.opacity(0.06),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            ),
                            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                        )

                    if room.pendingTasks.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Spacer(minLength: 0)
                            Text("Tudo feito")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(.primary)
                            Text("Suas tarefas estão em dia.")
                                .font(.system(size: 13))
                                .foregroundStyle(.secondary)
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(room.pendingTasks.prefix(3))) { task in
                                HStack(spacing: 2) {
                                    Button(intent: CompleteTaskFromWidgetIntent(occurrenceID: task.occurrenceID)) {
                                        CheckTarget(color: room.tintColor, circle: 22, side: 40)
                                    }
                                    .buttonStyle(.plain)

                                    Link(destination: task.deepLinkURL) {
                                        Text(task.name)
                                            .font(.system(size: 14, weight: .regular))
                                            .foregroundStyle(.primary)
                                            .lineLimit(1)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                    }
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .widgetURL(WidgetSnapshot.defaultURL)
            } else {
                WidgetEmptyDoneView()
                    .widgetURL(WidgetSnapshot.defaultURL)
            }
        }
    }
}

// MARK: - Componentes Visuais Compartilhados (Design System do Widget)

/// Círculo de check dentro de uma área de toque maior (o botão do widget só responde dentro do próprio rótulo).
private struct CheckTarget: View {
    let color: Color
    let circle: CGFloat
    let side: CGFloat

    var body: some View {
        Circle()
            .strokeBorder(color, lineWidth: 2)
            .frame(width: circle, height: circle)
            // O círculo encosta na borda esquerda (como no Lembretes); a área de toque se estende para a direita e para cima/baixo.
            .frame(width: circle + 12, height: side, alignment: .leading)
            .contentShape(Rectangle())
    }
}

private struct RoomBadgeInfo: Identifiable, Hashable {
    let id: String
    let icon: String
    let tint: Color
}

private func distinctRoomBadges(from tasks: [WidgetTaskItem], limit: Int) -> [RoomBadgeInfo] {
    var seen = Set<String>()
    var result: [RoomBadgeInfo] = []
    for task in tasks {
        let key = task.roomID?.uuidString ?? "\(task.roomName ?? "")-\(task.colorRawValue)"
        if seen.insert(key).inserted {
            result.append(
                RoomBadgeInfo(
                    id: key,
                    icon: task.roomIcon,
                    tint: task.tintColor
                )
            )
            if result.count == limit { break }
        }
    }
    return result
}

/// Pilha horizontal de até 3 ícones circulares de cômodo (usada em A · Lista e M2 · Lista com prazo).
private struct RoomBadgeStack: View {
    let badges: [RoomBadgeInfo]

    var body: some View {
        HStack(spacing: -5) {
            ForEach(badges) { badge in
                ZStack {
                    Circle()
                        .fill(badge.tint)
                        .frame(width: 24, height: 24)
                        .overlay {
                            Circle()
                                .strokeBorder(Color(uiColor: .systemBackground), lineWidth: 1.5)
                        }

                    Image(systemName: badge.icon)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
        }
    }
}

/// Bloco de resumo do cômodo (topo com anel de progresso + número de restantes; rodapé com nome do cômodo e término do ciclo).
private struct RoomSummaryBlockContent: View {
    let room: WidgetRoomSummary
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                RoomProgressRingIcon(
                    icon: room.icon,
                    tint: room.tintColor,
                    progress: room.progressFraction
                )

                Spacer(minLength: 4)

                VStack(alignment: .trailing, spacing: -2) {
                    Text("\(room.pendingTasks.count)")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(.primary)

                    Text(room.pendingTasks.count == 1 ? String(localized: "restante") : String(localized: "restantes"))
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(room.name)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Text(WidgetDeadlineFormatter.formatCycleEnd(room.periodEnd, now: now))
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

/// Anel de progresso circular ao redor do ícone do cômodo (usado em C1c e M5).
private struct RoomProgressRingIcon: View {
    let icon: String
    let tint: Color
    let progress: Double

    var body: some View {
        ZStack {
            Circle()
                .stroke(tint.opacity(0.22), lineWidth: 4)
                .frame(width: 46, height: 46)

            Circle()
                .trim(from: 0, to: max(min(progress, 1), 0.12))
                .stroke(
                    tint,
                    style: StrokeStyle(lineWidth: 4, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .frame(width: 46, height: 46)

            Circle()
                .fill(tint)
                .frame(width: 32, height: 32)

            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
        }
    }
}

/// D · Estado vazio ("Tudo feito / Suas tarefas estão em dia.").
private struct WidgetEmptyDoneView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                Circle()
                    .fill(Color.green)
                    .frame(width: 32, height: 32)
                Image(systemName: "checkmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
            }

            Spacer(minLength: 8)

            VStack(alignment: .leading, spacing: 3) {
                Text("Tudo feito")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.primary)

                Text("Suas tarefas estão em dia.")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct WidgetStatusView: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
