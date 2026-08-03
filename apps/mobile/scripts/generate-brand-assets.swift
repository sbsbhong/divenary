#!/usr/bin/env swift

import CoreGraphics
import Foundation
import ImageIO
import QuartzCore
import UniformTypeIdentifiers

enum BrandAssetConfig {
  static let splashCornerRadiusRatio = 0.22
  static let androidSplashSizes = [
    "mdpi": 96,
    "hdpi": 144,
    "xhdpi": 192,
    "xxhdpi": 288,
    "xxxhdpi": 384,
  ]
  static let androidLauncherSizes = [
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
  ]
}

enum BrandAssetError: Error, CustomStringConvertible {
  case cannotRead(String)
  case cannotCreateContext(Int)
  case cannotRender(Int)
  case cannotWrite(String)

  var description: String {
    switch self {
    case let .cannotRead(path):
      return "Cannot read image: \(path)"
    case let .cannotCreateContext(size):
      return "Cannot create image context at size \(size)"
    case let .cannotRender(size):
      return "Cannot render image at size \(size)"
    case let .cannotWrite(path):
      return "Cannot write PNG: \(path)"
    }
  }
}

let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
let mobileRoot = scriptURL.deletingLastPathComponent().deletingLastPathComponent()

func loadImage(_ path: String) throws -> CGImage {
  let url = mobileRoot.appendingPathComponent(path)

  guard
    let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    throw BrandAssetError.cannotRead(url.path)
  }

  return image
}

func writePNG(_ image: CGImage, to path: String) throws {
  let url = mobileRoot.appendingPathComponent(path)

  guard let destination = CGImageDestinationCreateWithURL(
    url as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
  ) else {
    throw BrandAssetError.cannotWrite(url.path)
  }

  CGImageDestinationAddImage(destination, image, nil)

  guard CGImageDestinationFinalize(destination) else {
    throw BrandAssetError.cannotWrite(url.path)
  }
}

func makeContext(size: Int, includesAlpha: Bool) throws -> CGContext {
  let alphaInfo: CGImageAlphaInfo = includesAlpha ? .premultipliedLast : .noneSkipLast

  guard let context = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: size * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: alphaInfo.rawValue
  ) else {
    throw BrandAssetError.cannotCreateContext(size)
  }

  context.setAllowsAntialiasing(true)
  context.setShouldAntialias(true)
  context.interpolationQuality = .high
  return context
}

func render(source: CGImage, size: Int, rounded: Bool) throws -> CGImage {
  let supersample = rounded ? 4 : 1
  let renderSize = size * supersample
  let context = try makeContext(size: renderSize, includesAlpha: rounded)
  let renderBounds = CGRect(
    x: 0,
    y: 0,
    width: CGFloat(renderSize),
    height: CGFloat(renderSize)
  )

  if rounded {
    let layer = CALayer()
    layer.frame = renderBounds
    layer.contents = source
    layer.contentsGravity = .resizeAspectFill
    layer.cornerRadius = BrandAssetConfig.splashCornerRadiusRatio * CGFloat(renderSize)
    layer.cornerCurve = .continuous
    layer.masksToBounds = true
    layer.render(in: context)
  } else {
    context.draw(source, in: renderBounds)
  }

  guard let rendered = context.makeImage() else {
    throw BrandAssetError.cannotRender(renderSize)
  }

  guard supersample > 1 else {
    return rendered
  }

  let outputContext = try makeContext(size: size, includesAlpha: true)
  outputContext.draw(
    rendered,
    in: CGRect(x: 0, y: 0, width: CGFloat(size), height: CGFloat(size))
  )

  guard let output = outputContext.makeImage() else {
    throw BrandAssetError.cannotRender(size)
  }

  return output
}

let light = try loadImage("src/assets/brand/app-logo-light.png")
let dark = try loadImage("src/assets/brand/app-logo-dark.png")

let iosSplashFiles = [
  (96, "splash-mark.png"),
  (192, "splash-mark@2x.png"),
  (288, "splash-mark@3x.png"),
]

for (size, filename) in iosSplashFiles {
  let directory = "ios/Divenary/Images.xcassets/SplashMark.imageset/"
  let darkFilename = filename.replacingOccurrences(
    of: "splash-mark",
    with: "splash-mark-dark"
  )

  try writePNG(
    try render(source: light, size: size, rounded: true),
    to: directory + filename
  )
  try writePNG(
    try render(source: dark, size: size, rounded: true),
    to: directory + darkFilename
  )
}

try writePNG(
  try render(source: light, size: 1024, rounded: false),
  to: "ios/Divenary/Images.xcassets/AppIcon.appiconset/app-icon.png"
)
try writePNG(
  try render(source: dark, size: 1024, rounded: false),
  to: "ios/Divenary/Images.xcassets/AppIcon.appiconset/app-icon-dark.png"
)
try writePNG(
  try render(source: light, size: 1024, rounded: false),
  to: "ios/DivenaryWatchApp/Assets.xcassets/AppIcon.appiconset/app-icon.png"
)

for (density, size) in BrandAssetConfig.androidSplashSizes {
  try writePNG(
    try render(source: light, size: size, rounded: true),
    to: "android/app/src/main/res/drawable-\(density)/splash_mark.png"
  )
  try writePNG(
    try render(source: dark, size: size, rounded: true),
    to: "android/app/src/main/res/drawable-night-\(density)/splash_mark.png"
  )
}

for (density, size) in BrandAssetConfig.androidLauncherSizes {
  for filename in ["ic_launcher.png", "ic_launcher_round.png"] {
    try writePNG(
      try render(source: light, size: size, rounded: false),
      to: "android/app/src/main/res/mipmap-\(density)/\(filename)"
    )
    try writePNG(
      try render(source: dark, size: size, rounded: false),
      to: "android/app/src/main/res/mipmap-night-\(density)/\(filename)"
    )
  }
}

print(
  "Generated Divenary brand assets "
    + "(splashCornerRadiusRatio=\(BrandAssetConfig.splashCornerRadiusRatio))"
)
