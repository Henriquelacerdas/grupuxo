import AppIntents
import SwiftUI
import WidgetKit

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
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Minhas tarefas")
        .description("Veja e conclua suas tarefas pendentes da casa.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .systemLarge,
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
            smallView
        case .systemMedium:
            listView(maxItems: 3)
        case .systemLarge:
            listView(maxItems: 6)
        case .accessoryCircular:
            circularLockScreenView
        case .accessoryRectangular:
            rectangularLockScreenView
        default:
            listView(maxItems: 3)
        }
    }

    // MARK: - Pequeno (systemSmall)

    @ViewBuilder
    private var smallView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "house.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if entry.snapshot.status == .ready {
                    Text("\(entry.snapshot.tasks.count)")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Color.accentColor.opacity(0.18), in: Capsule())
                }
            }

            Spacer(minLength: 0)

            switch entry.snapshot.status {
            case .notSignedIn:
                statusMessage(
                    icon: "person.crop.circle.badge.exclamationmark",
                    title: String(localized: "Entre na conta"),
                    subtitle: String(localized: "Abra o Reveza para ver suas tarefas.")
                )

            case .noHouse:
                statusMessage(
                    icon: "house",
                    title: String(localized: "Sem casa"),
                    subtitle: String(localized: "Entre ou crie uma casa no Reveza.")
                )

            case .ready:
                if let first = entry.snapshot.tasks.first {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(first.name)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)

                        if let subtitle = taskSubtitle(for: first) {
                            Text(subtitle)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }

                        Button(intent: CompleteTaskFromWidgetIntent(occurrenceID: first.occurrenceID)) {
                            Label("Concluir", systemImage: "checkmark.circle.fill")
                                .font(.caption.weight(.semibold))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(first.tintColor)
                    }
                } else {
                    statusMessage(
                        icon: "checkmark.circle.fill",
                        title: String(localized: "Tudo em dia!"),
                        subtitle: entry.snapshot.houseName
                    )
                }
            }
        }
        .widgetURL(WidgetSnapshot.defaultURL)
    }

    // MARK: - Médio e Grande (systemMedium / systemLarge)

    @ViewBuilder
    private func listView(maxItems: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            headerView

            switch entry.snapshot.status {
            case .notSignedIn:
                Spacer(minLength: 0)
                statusMessage(
                    icon: "person.crop.circle.badge.exclamationmark",
                    title: String(localized: "Abra o app e entre na sua conta"),
                    subtitle: String(localized: "Suas tarefas aparecerão aqui automaticamente.")
                )
                Spacer(minLength: 0)

            case .noHouse:
                Spacer(minLength: 0)
                statusMessage(
                    icon: "house",
                    title: String(localized: "Você ainda não faz parte de uma casa"),
                    subtitle: String(localized: "Crie ou entre em uma casa no Reveza.")
                )
                Spacer(minLength: 0)

            case .ready:
                if entry.snapshot.tasks.isEmpty {
                    Spacer(minLength: 0)
                    HStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.green)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Tudo em dia!")
                                .font(.subheadline.weight(.semibold))
                            Text("Você não tem tarefas pendentes agora.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                } else {
                    let visible = Array(entry.snapshot.tasks.prefix(maxItems))
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(visible) { task in
                            taskRow(task)
                        }
                    }
                    Spacer(minLength: 0)
                    let remaining = entry.snapshot.tasks.count - visible.count
                    if remaining > 0 {
                        Text("+\(remaining) pendentes no app")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .widgetURL(WidgetSnapshot.defaultURL)
    }

    private var headerView: some View {
        HStack(spacing: 6) {
            Image(systemName: "checklist")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.accentColor)
            Text(entry.snapshot.houseName.isEmpty ? String(localized: "Minhas tarefas") : entry.snapshot.houseName)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer()
            if entry.snapshot.status == .ready {
                Text("\(entry.snapshot.tasks.count) pendentes")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func taskRow(_ task: WidgetTaskItem) -> some View {
        HStack(spacing: 10) {
            Button(intent: CompleteTaskFromWidgetIntent(occurrenceID: task.occurrenceID)) {
                Image(systemName: "circle")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(task.tintColor)
            }
            .buttonStyle(.plain)

            Link(destination: task.deepLinkURL) {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(task.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                        if let subtitle = taskSubtitle(for: task) {
                            Text(subtitle)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
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
                    if let subtitle = taskSubtitle(for: first) {
                        Text(subtitle)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                } else {
                    Text("Tudo em dia!")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .widgetURL(WidgetSnapshot.defaultURL)
    }

    // MARK: - Auxiliares

    private func statusMessage(icon: String, title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
    }

    private func taskSubtitle(for task: WidgetTaskItem) -> String? {
        var parts: [String] = []
        if let roomName = task.roomName, !roomName.isEmpty {
            parts.append(roomName)
        }
        if let dueAt = task.dueAt {
            parts.append(dueAt.formatted(date: .abbreviated, time: .omitted))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

