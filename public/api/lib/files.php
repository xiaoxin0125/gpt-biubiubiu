<?php

declare(strict_types=1);

function public_base_dir(): string
{
    return dirname(__DIR__, 2);
}

function public_url_for_path(string $path): string
{
    $relative = str_replace('\\', '/', $path);
    $root = str_replace('\\', '/', public_base_dir());
    if (strpos($relative, $root) === 0) $relative = substr($relative, strlen($root));
    return '/' . ltrim($relative, '/');
}

function ensure_dir(string $path): void
{
    clearstatcache(true, $path);
    if (is_dir($path)) {
        if (!is_writable($path)) throw new RuntimeException('目录不可写：' . $path);
        return;
    }

    $nearestParent = dirname($path);
    while ($nearestParent !== '' && $nearestParent !== '.' && !is_dir($nearestParent)) {
        $next = dirname($nearestParent);
        if ($next === $nearestParent) break;
        $nearestParent = $next;
    }

    if (!@mkdir($path, 0775, true)) {
        clearstatcache(true, $path);
        if (!is_dir($path)) {
            $detail = '';
            if ($nearestParent !== '' && is_dir($nearestParent)) {
                $detail = '；最近存在父目录：' . $nearestParent . '；父目录可写：' . (is_writable($nearestParent) ? '是' : '否');
            }
            throw new RuntimeException('无法创建目录：' . $path . $detail);
        }
    }

    clearstatcache(true, $path);
    if (!is_writable($path)) throw new RuntimeException('目录不可写：' . $path);
}

function extension_for_mime(string $mime): string
{
    $mime = strtolower($mime);
    if ($mime === 'image/jpeg' || $mime === 'image/jpg') return 'jpg';
    if ($mime === 'image/webp') return 'webp';
    if ($mime === 'image/gif') return 'gif';
    return 'png';
}

function mime_from_binary(string $binary, string $fallback = 'image/png'): string
{
    $info = @getimagesizefromstring($binary);
    if (is_array($info) && !empty($info['mime'])) return (string) $info['mime'];
    return $fallback ?: 'image/png';
}

function supported_image_mime(string $mime): bool
{
    return in_array(strtolower($mime), ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'], true);
}

function validate_image_binary(string $binary, string $fallbackMime = 'image/png'): string
{
    if ($binary === '') json_response(['error' => '图片内容为空'], 400);
    if (strlen($binary) > MAX_IMAGE_UPLOAD_BYTES) json_response(['error' => '图片不能超过 20MB'], 413);

    $mime = mime_from_binary($binary, $fallbackMime);
    if (!supported_image_mime($mime)) json_response(['error' => '仅支持 PNG、JPEG、WebP 或 GIF 图片'], 400);
    if (!@getimagesizefromstring($binary)) json_response(['error' => '图片内容无法识别'], 400);

    return $mime;
}

function local_public_file_from_url(string $url): string
{
    $path = parse_url($url, PHP_URL_PATH) ?: $url;
    if ($path === '' || preg_match('#^https?://#i', $url)) return '';
    if (!preg_match('#^/wall-images/(original|display)/[a-f0-9]{24}(?:-[0-9]+-[0-9]+)?\.(png|jpg|jpeg|webp|gif)$#i', $path)) return '';

    $candidate = realpath(public_base_dir() . '/' . ltrim($path, '/'));
    $root = realpath(public_base_dir() . '/wall-images');
    if (!$candidate || !$root || strpos(str_replace('\\', '/', $candidate), rtrim(str_replace('\\', '/', $root), '/') . '/') !== 0) return '';
    return is_file($candidate) ? $candidate : '';
}

function fetch_remote_image_binary(string $url): string
{
    $response = outbound_http_request('GET', $url, [
        'Accept: image/png,image/jpeg,image/webp,image/gif',
    ], '', 15, MAX_IMAGE_UPLOAD_BYTES);
    $binary = (string) ($response['body'] ?? '');
    $status = (int) ($response['status'] ?? 0);
    if ($status >= 400 || $binary === '') json_response(['error' => '无法读取远程图片'], 400);
    return $binary;
}

function decode_image_payload(array $image): array
{
    $imageUrl = trim((string) ($image['url'] ?? ''));
    $imageB64 = trim((string) ($image['b64_json'] ?? ''));
    $mime = trim((string) ($image['mime'] ?? 'image/png')) ?: 'image/png';

    if ($imageB64 !== '') {
        $imageB64 = preg_replace('#^data:(image/[a-z0-9.+-]+);base64,#i', '', $imageB64);
        $binary = base64_decode($imageB64, true);
        if ($binary === false) json_response(['error' => '图片 base64 无法解析'], 400);
        return ['binary' => $binary, 'mime' => validate_image_binary($binary, $mime), 'sourceUrl' => ''];
    }

    if ($imageUrl !== '') {
        $sourcePath = local_public_file_from_url($imageUrl);
        $binary = $sourcePath !== '' ? @file_get_contents($sourcePath) : fetch_remote_image_binary($imageUrl);
        if ($binary === false) json_response(['error' => '无法读取上墙图片'], 400);
        return ['binary' => $binary, 'mime' => validate_image_binary($binary, $mime), 'sourceUrl' => $imageUrl];
    }

    json_response(['error' => '缺少可上墙的图片'], 400);
}

function create_image_resource(string $binary, string $mime)
{
    if (!function_exists('imagecreatefromstring')) return null;
    $image = @imagecreatefromstring($binary);
    if (!$image) return null;
    if (function_exists('imagepalettetotruecolor')) @imagepalettetotruecolor($image);
    if (in_array(strtolower($mime), ['image/png', 'image/webp'], true)) {
        imagealphablending($image, true);
        imagesavealpha($image, true);
    }
    return $image;
}

function encode_image_candidate($resource, string $path, string $mime, int $quality): bool
{
    $mime = strtolower($mime);
    if (($mime === 'image/webp') && function_exists('imagewebp')) return imagewebp($resource, $path, $quality);
    if (($mime === 'image/jpeg' || $mime === 'image/jpg') && function_exists('imagejpeg')) return imagejpeg($resource, $path, $quality);
    if ($mime === 'image/png' && function_exists('imagepng')) {
        $level = max(0, min(9, (int) round((100 - $quality) / 11)));
        return imagepng($resource, $path, $level);
    }
    return false;
}

function compress_display_image(string $binary, string $originalMime, string $targetPath): array
{
    if (strlen($binary) <= WALL_DISPLAY_MAX_BYTES) {
        file_put_contents($targetPath, $binary);
        return ['path' => $targetPath, 'mime' => $originalMime, 'bytes' => filesize($targetPath) ?: strlen($binary)];
    }

    $image = create_image_resource($binary, $originalMime);
    if (!$image) throw new RuntimeException('无法压缩展示图，请检查服务器 GD 图片扩展。');

    $targetMime = function_exists('imagewebp') ? 'image/webp' : 'image/jpeg';
    $targetPath = preg_replace('/\.[a-z0-9]+$/i', '.' . extension_for_mime($targetMime), $targetPath) ?: $targetPath;
    $width = imagesx($image);
    $height = imagesy($image);
    $qualities = [88, 80, 72, 64, 56, 48, 40, 32, 24, 18, 12];
    $scales = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42, 0.36, 0.3, 0.24, 0.18, 0.12];
    $bestPath = '';
    $bestBytes = PHP_INT_MAX;

    foreach ($scales as $scale) {
        $work = $image;
        if ($scale < 1) {
            $nextWidth = max(1, (int) floor($width * $scale));
            $nextHeight = max(1, (int) floor($height * $scale));
            $work = imagescale($image, $nextWidth, $nextHeight);
            if (!$work) continue;
        }

        foreach ($qualities as $quality) {
            $candidatePath = preg_replace('/\.[a-z0-9]+$/i', '-' . (int) round($scale * 100) . '-' . $quality . '.' . extension_for_mime($targetMime), $targetPath) ?: $targetPath;
            if (!encode_image_candidate($work, $candidatePath, $targetMime, $quality)) continue;
            $bytes = filesize($candidatePath) ?: PHP_INT_MAX;
            if ($bytes < $bestBytes) {
                if ($bestPath && $bestPath !== $candidatePath && is_file($bestPath)) @unlink($bestPath);
                $bestPath = $candidatePath;
                $bestBytes = $bytes;
            } elseif (is_file($candidatePath)) {
                @unlink($candidatePath);
            }
            if ($bytes <= WALL_DISPLAY_MAX_BYTES) break 2;
        }

        if ($work !== $image) imagedestroy($work);
    }

    imagedestroy($image);
    if ($bestPath === '') throw new RuntimeException('展示图压缩失败。');
    if ($bestBytes > WALL_DISPLAY_MAX_BYTES) {
        if (is_file($bestPath)) @unlink($bestPath);
        throw new RuntimeException('展示图无法压缩到 1M 以下。');
    }

    return ['path' => $bestPath, 'mime' => $targetMime, 'bytes' => $bestBytes];
}

function store_image_files(array $image): array
{
    $payload = decode_image_payload($image);
    $mime = $payload['mime'];
    $id = bin2hex(random_bytes(12));
    $originalDir = public_base_dir() . '/wall-images/original';
    $displayDir = public_base_dir() . '/wall-images/display';
    ensure_dir($originalDir);
    ensure_dir($displayDir);

    $originalPath = $originalDir . '/' . $id . '.' . extension_for_mime($mime);
    file_put_contents($originalPath, $payload['binary']);
    $displayBasePath = $displayDir . '/' . $id . '.' . extension_for_mime($mime);
    $display = compress_display_image($payload['binary'], $mime, $displayBasePath);

    return [
        'imageMime' => $mime,
        'originalPath' => $originalPath,
        'displayPath' => $display['path'],
        'originalUrl' => public_url_for_path($originalPath),
        'displayUrl' => public_url_for_path($display['path']),
        'originalBytes' => filesize($originalPath) ?: strlen($payload['binary']),
        'displayBytes' => $display['bytes'],
    ];
}

function stored_generated_image(array $image, string $fallbackMime = 'image/png'): array
{
    $url = trim((string) ($image['url'] ?? ($image['image_url'] ?? '')));
    $b64 = trim((string) ($image['b64_json'] ?? ($image['image_b64'] ?? '')));
    $mime = trim((string) ($image['imageMime'] ?? ($image['mime'] ?? $fallbackMime))) ?: $fallbackMime;

    if ($url !== '') return store_image_files(['url' => $url, 'mime' => $mime]);
    if ($b64 !== '') return store_image_files(['b64_json' => $b64, 'mime' => $mime]);
    return [];
}

function delete_generated_image_files(array $row): void
{
    $seen = [];
    foreach (['display_url', 'original_url', 'image_url'] as $key) {
        $url = trim((string) ($row[$key] ?? ''));
        if ($url === '' || preg_match('#^https?://#i', $url)) continue;
        $path = local_public_file_from_url($url);
        if ($path === '' || isset($seen[$path])) continue;
        $seen[$path] = true;
        @unlink($path);
    }
}