// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "GrupuxoDomain",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "GrupuxoDomain", targets: ["GrupuxoDomain"])
    ],
    targets: [
        .target(
            name: "GrupuxoDomain",
            swiftSettings: [.enableUpcomingFeature("MemberImportVisibility")]
        ),
        .testTarget(
            name: "GrupuxoDomainTests",
            dependencies: ["GrupuxoDomain"]
        )
    ],
    swiftLanguageModes: [.v6]
)
