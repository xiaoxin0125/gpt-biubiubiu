<?php

declare(strict_types=1);

function wall_image_from_job(array $job): array
{
    $displayUrl = trim((string) (($job['display_url'] ?? '') ?: ($job['image_url'] ?? '')));
    $originalUrl = trim((string) (($job['original_url'] ?? '') ?: $displayUrl));
    if ($displayUrl === '' || $originalUrl === '') json_response(['error' => '作品没有可上墙的服务器图片'], 400);

    $displayPath = local_public_file_from_url($displayUrl);
    $originalPath = local_public_file_from_url($originalUrl);
    $displayBytes = isset($job['display_bytes']) ? (int) $job['display_bytes'] : null;
    $originalBytes = isset($job['original_bytes']) ? (int) $job['original_bytes'] : null;
    if (!$displayBytes && $displayPath !== '' && is_file($displayPath)) $displayBytes = filesize($displayPath) ?: null;
    if (!$originalBytes && $originalPath !== '' && is_file($originalPath)) $originalBytes = filesize($originalPath) ?: null;

    return [
        'imageMime' => (string) (($job['image_mime'] ?? '') ?: 'image/png'),
        'originalPath' => $originalPath,
        'displayPath' => $displayPath,
        'originalUrl' => $originalUrl,
        'displayUrl' => $displayUrl,
        'originalBytes' => $originalBytes,
        'displayBytes' => $displayBytes,
    ];
}

function image_job_for_wall(array $user, int $sourceJobId): array
{
    if ($sourceJobId <= 0) json_response(['error' => '请先生成并保存作品后再上墙'], 400);

    if (!empty($user['isAdmin'])) {
        $stmt = pdo()->prepare('SELECT * FROM image_jobs WHERE id = ? AND status = ? LIMIT 1');
        $stmt->execute([$sourceJobId, 'completed']);
    } else {
        $stmt = pdo()->prepare('SELECT * FROM image_jobs WHERE id = ? AND user_id = ? AND status = ? LIMIT 1');
        $stmt->execute([$sourceJobId, (int) $user['id'], 'completed']);
    }

    $job = $stmt->fetch();
    if (!$job) json_response(['error' => '只能上墙自己的已保存作品'], 403);
    return $job;
}

function image_job_author_name(array $job, array $fallbackUser): string
{
    $userId = (int) ($job['user_id'] ?? 0);
    if ($userId > 0) {
        $stmt = pdo()->prepare('SELECT username, display_name FROM users WHERE id = ? LIMIT 1');
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        if ($row) return trim((string) ($row['display_name'] ?? '')) ?: (string) $row['username'];
    }

    return (string) ($fallbackUser['displayName'] ?? ($fallbackUser['username'] ?? '未知艺术家'));
}

function handle_create_wall_item(array $user, array $body): array
{
    $sourceJobId = max(0, (int) ($body['sourceJobId'] ?? ($body['jobId'] ?? (($body['params']['sourceJobId'] ?? 0) ?: 0))));
    $job = image_job_for_wall($user, $sourceJobId);

    if (!empty($job['wall_item_id'])) {
        $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE id = ? LIMIT 1');
        $stmt->execute([(int) $job['wall_item_id']]);
        $existing = $stmt->fetch();
        if ($existing) return ['item' => client_wall_item($existing)];
    }

    $storedImage = wall_image_from_job($job);
    $form = is_array($body['form'] ?? null) ? $body['form'] : [];
    $bodyParams = is_array($body['params'] ?? null) ? $body['params'] : $form;
    $params = $bodyParams ?: image_job_params($job);
    $duration = isset($body['durationSeconds']) ? max(0, (int) $body['durationSeconds']) : (isset($params['durationSeconds']) ? max(0, (int) $params['durationSeconds']) : null);
    if ($duration !== null) $params['durationSeconds'] = $duration;
    $params['sourceJobId'] = $sourceJobId;
    $params['source'] = normalize_job_mode((string) ($job['mode'] ?? ($params['source'] ?? 'generation')));

    $prompt = trim((string) ($body['prompt'] ?? ($form['prompt'] ?? ($job['prompt'] ?? '未命名作品'))));
    $revisedPrompt = extract_revised_prompt($body) ?: trim((string) ($job['revised_prompt'] ?? ''));
    $ownerId = (int) ($job['user_id'] ?? $user['id']);
    $authorName = image_job_author_name($job, $user);

    $stmt = pdo()->prepare('INSERT INTO wall_items (user_id, client_id, author_name, prompt, revised_prompt, image_url, image_b64, image_mime, original_url, display_url, original_path, display_path, original_bytes, display_bytes, duration_seconds, params_json, source_job_id) VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $ownerId ?: null,
        $authorName,
        $prompt ?: '未命名作品',
        $revisedPrompt !== '' ? $revisedPrompt : null,
        $storedImage['displayUrl'],
        $storedImage['imageMime'],
        $storedImage['originalUrl'],
        $storedImage['displayUrl'],
        $storedImage['originalPath'] ?: null,
        $storedImage['displayPath'] ?: null,
        $storedImage['originalBytes'],
        $storedImage['displayBytes'],
        $duration,
        json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        $sourceJobId,
    ]);

    $wallItemId = (int) pdo()->lastInsertId();
    $stmt = pdo()->prepare('UPDATE image_jobs SET wall_item_id = ? WHERE id = ?');
    $stmt->execute([$wallItemId, $sourceJobId]);

    $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE id = ? LIMIT 1');
    $stmt->execute([$wallItemId]);
    return ['item' => client_wall_item($stmt->fetch())];
}

function delete_wall_item_files(array $item): void
{
    $sourceJobId = (int) ($item['source_job_id'] ?? 0);
    if ($sourceJobId > 0) return;

    delete_generated_image_files([
        'display_url' => $item['display_url'] ?? '',
        'original_url' => $item['original_url'] ?? '',
        'image_url' => $item['image_url'] ?? '',
    ]);
}

function handle_delete_wall_item(array $user, int $id): array
{
    $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $item = $stmt->fetch();
    if (!$item) json_response(['error' => '作品不存在'], 404);

    $isOwner = !empty($item['user_id']) && (int) $item['user_id'] === (int) $user['id'];
    if (!$isOwner && empty($user['isAdmin'])) json_response(['error' => '只能取消自己上墙的作品'], 403);

    if (!empty($item['source_job_id'])) {
        $stmt = pdo()->prepare('UPDATE image_jobs SET wall_item_id = NULL WHERE id = ?');
        $stmt->execute([(int) $item['source_job_id']]);
    }
    $stmt = pdo()->prepare('UPDATE image_jobs SET wall_item_id = NULL WHERE wall_item_id = ?');
    $stmt->execute([$id]);

    delete_wall_item_files($item);

    $stmt = pdo()->prepare('DELETE FROM wall_items WHERE id = ?');
    $stmt->execute([$id]);
    return ['ok' => true];
}

function client_wall_item(array $item): array
{
    $params = [];
    if (!empty($item['params_json'])) {
        $decoded = is_string($item['params_json']) ? json_decode($item['params_json'], true) : $item['params_json'];
        $params = is_array($decoded) ? $decoded : [];
    }

    $displayUrl = (string) (($item['display_url'] ?? '') ?: ($item['image_url'] ?? ''));
    $originalUrl = (string) (($item['original_url'] ?? '') ?: (($item['image_url'] ?? '') ?: $displayUrl));
    $duration = $item['duration_seconds'] ?? ($params['durationSeconds'] ?? null);
    $createdAt = (string) (($item['created_at'] ?? '') ?: date(DATE_ATOM));

    return [
        'id' => (int) ($item['id'] ?? 0),
        'wallItemId' => (int) ($item['id'] ?? 0),
        'userId' => isset($item['user_id']) ? (int) $item['user_id'] : null,
        'sourceJobId' => isset($item['source_job_id']) ? (int) $item['source_job_id'] : null,
        'url' => $displayUrl,
        'image_url' => $displayUrl,
        'downloadUrl' => $originalUrl,
        'originalUrl' => $originalUrl,
        'b64_json' => $displayUrl ? '' : (string) ($item['image_b64'] ?? ''),
        'imageMime' => (string) (($item['image_mime'] ?? '') ?: 'image/png'),
        'originalBytes' => isset($item['original_bytes']) ? (int) $item['original_bytes'] : null,
        'displayBytes' => isset($item['display_bytes']) ? (int) $item['display_bytes'] : null,
        'prompt' => (string) (($item['prompt'] ?? '') ?: ''),
        'revised_prompt' => (string) (($item['revised_prompt'] ?? '') ?: ''),
        'form' => $params,
        'apiName' => (string) ($params['apiName'] ?? ($params['api_name'] ?? '')),
        'authorName' => (string) (($item['author_name'] ?? '') ?: '未知艺术家'),
        'createdAt' => $createdAt,
        'durationSeconds' => $duration !== null && $duration !== '' ? (int) $duration : null,
        'isOnWall' => true,
        'source' => $params['source'] ?? (($params['referenceName'] ?? '') !== '' ? 'edit' : 'generation'),
    ];
}

function handle_wall_mine(array $user): array
{
    $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE user_id = ? ORDER BY created_at DESC LIMIT 80');
    $stmt->execute([(int) $user['id']]);
    return ['items' => array_map('client_wall_item', $stmt->fetchAll())];
}

function handle_wall_list(): array
{
    require_database();
    if (wall_requires_login()) require_user();
    $rows = pdo()->query('SELECT * FROM wall_items ORDER BY created_at DESC LIMIT 80')->fetchAll();
    return ['items' => array_map('client_wall_item', $rows)];
}

function handle_wall_detail(int $id): array
{
    require_database();
    if (wall_requires_login()) require_user();
    $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $item = $stmt->fetch();
    if (!$item) json_response(['exists' => false], 404);
    return ['exists' => true, 'item' => client_wall_item($item)];
}