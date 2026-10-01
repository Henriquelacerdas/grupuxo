// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "GrupuxoBackend",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "WhatsAppCore", targets: ["WhatsAppCore"]),
        .library(name: "WhatsAppInMemory", targets: ["WhatsAppInMemory"])
    ],
    dependencies: [
        .package(path: "../grupuxo/Packages/GrupuxoDomain"),
        .package(url: "https://github.com/apple/swift-crypto.git", from: "3.0.0")
    ],
    targets: [
        .target(
            name: "WhatsAppCore",
            dependencies: [
                .product(name: "GrupuxoDomain", package: "GrupuxoDomain"),
                .product(name: "Crypto", package: "swift-crypto")
            ]
        ),
        .target(
            name: "WhatsAppInMemory",
            dependencies: ["WhatsAppCore"]
        ),
        .testTarget(
            name: "WhatsAppCoreTests",
            dependencies: [
                "WhatsAppCore",
                "WhatsAppInMemory",
                .product(name: "Crypto", package: "swift-crypto")
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
