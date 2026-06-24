$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$iconDir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

function New-ReviewIconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [math]::Round($size * 0.08)
  $rect = New-Object System.Drawing.Rectangle $pad, $pad, ($size - $pad * 2), ($size - $pad * 2)
  $radius = [math]::Round($size * 0.22)

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 3, 199, 90),
    [System.Drawing.Color]::FromArgb(255, 2, 132, 63),
    135
  )
  $g.FillPath($brush, $path)

  $bubbleW = [math]::Round($size * 0.56)
  $bubbleH = [math]::Round($size * 0.42)
  $bubbleX = [math]::Round($size * 0.22)
  $bubbleY = [math]::Round($size * 0.24)
  $bubbleRect = New-Object System.Drawing.Rectangle $bubbleX, $bubbleY, $bubbleW, $bubbleH
  $bubbleRadius = [math]::Round($size * 0.1)

  $bubblePath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $bd = $bubbleRadius * 2
  $bubblePath.AddArc($bubbleRect.X, $bubbleRect.Y, $bd, $bd, 180, 90)
  $bubblePath.AddArc($bubbleRect.Right - $bd, $bubbleRect.Y, $bd, $bd, 270, 90)
  $bubblePath.AddArc($bubbleRect.Right - $bd, $bubbleRect.Bottom - $bd, $bd, $bd, 0, 90)
  $bubblePath.AddArc($bubbleRect.X, $bubbleRect.Bottom - $bd, $bd, $bd, 90, 90)
  $tail = @(
    (New-Object System.Drawing.Point ([math]::Round($size * 0.34)), ($bubbleRect.Bottom - [math]::Round($size * 0.02))),
    (New-Object System.Drawing.Point ([math]::Round($size * 0.28)), ($bubbleRect.Bottom + [math]::Round($size * 0.12))),
    (New-Object System.Drawing.Point ([math]::Round($size * 0.46)), ($bubbleRect.Bottom - [math]::Round($size * 0.01)))
  )
  $bubblePath.AddPolygon($tail)
  $bubblePath.CloseFigure()

  $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(245, 255, 252))
  $g.FillPath($whiteBrush, $bubblePath)

  $linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(210, 2, 132, 63)), ([math]::Max(1, [math]::Round($size * 0.045)))
  $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $lineLeft = $bubbleX + [math]::Round($size * 0.1)
  $lineRight = $bubbleX + $bubbleW - [math]::Round($size * 0.1)
  $lineY1 = $bubbleY + [math]::Round($size * 0.12)
  $lineY2 = $lineY1 + [math]::Round($size * 0.09)
  $lineY3 = $lineY2 + [math]::Round($size * 0.09)
  $g.DrawLine($linePen, $lineLeft, $lineY1, $lineRight, $lineY1)
  $g.DrawLine($linePen, $lineLeft, $lineY2, ($lineRight - [math]::Round($size * 0.08)), $lineY2)
  $g.DrawLine($linePen, $lineLeft, $lineY3, ($lineRight - [math]::Round($size * 0.14)), $lineY3)

  $starSize = [math]::Round($size * 0.16)
  $starX = [math]::Round($size * 0.66)
  $starY = [math]::Round($size * 0.62)
  $starBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255))
  $points = New-Object System.Drawing.PointF[] 10
  $cx = $starX + $starSize / 2
  $cy = $starY + $starSize / 2
  $outer = $starSize / 2
  $inner = $outer * 0.42
  for ($i = 0; $i -lt 10; $i++) {
    $angle = [math]::PI / 2 + $i * [math]::PI / 5
    $r = if ($i % 2 -eq 0) { $outer } else { $inner }
    $points[$i] = New-Object System.Drawing.PointF ($cx + [math]::Cos($angle) * $r), ($cy - [math]::Sin($angle) * $r)
  }
  $g.FillPolygon($starBrush, $points)

  $g.Dispose()
  return $bmp
}

foreach ($size in @(16, 32, 48, 128)) {
  $bmp = New-ReviewIconBitmap $size
  $out = Join-Path $iconDir ("icon-{0}.png" -f $size)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "Wrote $out"
}
