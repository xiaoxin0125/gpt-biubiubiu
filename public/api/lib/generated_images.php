<?php

declare(strict_types=1);

function extract_revised_prompt($value): string
{
    if (!is_array($value)) return '';
    foreach (['revised_prompt', 'revisedPrompt', 'prompt_revised'] as $key) {
        $prompt = trim((string) ($value[$key] ?? ''));
        if ($prompt !== '') return $prompt;
    }
    foreach (['data', 'images'] as $key) {
        if (!isset($value[$key]) || !is_array($value[$key])) continue;
        foreach ($value[$key] as $item) {
            $prompt = extract_revised_prompt($item);
            if ($prompt !== '') return $prompt;
        }
    }
    return '';
}

function normalize_job_mode(string $mode): string
{
    return $mode === 'edit' ? 'edit' : 'generation';
}

function normalize_revised_prompt(array $body): string
{
    return extract_revised_prompt($body);
}

function sanitize_log_payload($value)
{
    if (is_array($value)) {
        $next = [];
        foreach ($value as $key => $item) {
            if (preg_match('/authorization|api[_-]?key|token|secret/i', (string) $key)) continue;
            if (is_string($item) && strlen($item) > 4096 && preg_match('/^[a-z0-9+\/=\r\n]+$/i', $item)) {
                $next[$key] = '[base64 omitted]';
            } else {
                $next[$key] = sanitize_log_payload($item);
            }
        }
        return $next;
    }
    return $value;
}

function save_image_job(array $user, string $requestId, string $mode, string $prompt, array $params, array $result, ?string $error = null): int
{
    $firstImage = $result['data'][0] ?? [];
    $revisedPrompt = extract_revised_prompt($firstImage) ?: extract_revised_prompt($result);
    $displayUrl = (string) ($firstImage['url'] ?? ($firstImage['image_url'] ?? ''));
    $originalUrl = (string) ($firstImage['downloadUrl'] ?? ($firstImage['originalUrl'] ?? ($firstImage['original_url'] ?? $displayUrl)));
    $stmt = pdo()->prepare('INSERT INTO image_jobs (user_id, request_id, mode, status, prompt, revised_prompt, error_message, image_url, original_url, display_url, image_mime, original_bytes, display_bytes, image_b64, params_json, result_json, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())');
    $stmt->execute([
        $user['id'],
        $requestId,
        $mode,
        $error ? 'failed' : 'completed',
        $prompt,
        $revisedPrompt,
        $error,
        $displayUrl,
        $originalUrl,
        $displayUrl,
        $firstImage['imageMime'] ?? ($firstImage['image_mime'] ?? 'image/png'),
        isset($firstImage['originalBytes']) ? (int) $firstImage['originalBytes'] : null,
        isset($firstImage['displayBytes']) ? (int) $firstImage['displayBytes'] : null,
        '',
        json_encode(sanitize_log_payload($params), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        json_encode(sanitize_log_payload($result), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    return (int) pdo()->lastInsertId();
}

function client_generated_image(array $item): array
{
    $params = [];
    if (!empty($item['params_json'])) {
        $decoded = is_string($item['params_json']) ? json_decode($item['params_json'], true) : $item['params_json'];
        $params = is_array($decoded) ? $decoded : [];
    }

    $result = [];
    if (!empty($item['result_json'])) {
        $decoded = is_string($item['result_json']) ? json_decode($item['result_json'], true) : $item['result_json'];
        $result = is_array($decoded) ? $decoded : [];
    }

    $id = (int) ($item['id'] ?? 0);
    $firstImage = $result['data'][0] ?? [];
    $directImageUrl = (string) (($item['display_url'] ?? '') ?: (($item['image_url'] ?? '') ?: ''));
    $displayUrl = (string) ($directImageUrl ?: ($firstImage['url'] ?? ($firstImage['image_url'] ?? '')));
    $originalUrl = (string) (($item['original_url'] ?? '') ?: ($firstImage['downloadUrl'] ?? ($firstImage['originalUrl'] ?? ($firstImage['original_url'] ?? $displayUrl))));
    $imageParams = is_array($params['form'] ?? null) ? $params['form'] : (is_array($params['payload'] ?? null) ? $params['payload'] : (is_array($params['fields'] ?? null) ? $params['fields'] : $params));
    $completedAt = (string) (($item['completed_at'] ?? '') ?: '');
    $createdAt = $completedAt ?: (string) (($item['created_at'] ?? '') ?: date(DATE_ATOM));

    return [
        'id' => 'job-' . $id,
        'jobId' => $id,
        'sourceJobId' => $id,
        'wallItemId' => !empty($item['wall_item_id']) ? (int) $item['wall_item_id'] : null,
        'requestId' => (string) (($item['request_id'] ?? '') ?: ('job-' . $id)),
        'status' => (string) (($item['status'] ?? '') ?: 'completed'),
        'url' => $displayUrl,
        'image_url' => $displayUrl,
        'downloadUrl' => $originalUrl,
        'originalUrl' => $originalUrl,
        'b64_json' => '',
        'imageMime' => (string) (($item['image_mime'] ?? '') ?: ($firstImage['imageMime'] ?? 'image/png')),
        'originalBytes' => isset($item['original_bytes']) ? (int) $item['original_bytes'] : ($firstImage['originalBytes'] ?? null),
        'displayBytes' => isset($item['display_bytes']) ? (int) $item['display_bytes'] : ($firstImage['displayBytes'] ?? null),
        'prompt' => (string) (($item['prompt'] ?? '') ?: ($imageParams['prompt'] ?? '')),
        'revised_prompt' => (string) (($item['revised_prompt'] ?? '') ?: ($firstImage['revised_prompt'] ?? '')),
        'form' => $imageParams,
        'apiName' => (string) ($imageParams['apiName'] ?? ($imageParams['api_name'] ?? '')),
        'authorName' => '',
        'createdAt' => $createdAt,
        'finishedAt' => $completedAt ?: null,
        'isOnWall' => !empty($item['wall_item_id']),
        'source' => ($item['mode'] ?? '') === 'edit' ? 'edit' : 'generation',
    ];
}

function handle_generated_images(array $user): array
{
    $stmt = pdo()->prepare("SELECT id, user_id, request_id, mode, status, prompt, revised_prompt, image_url, original_url, display_url, image_mime, original_bytes, display_bytes, wall_item_id, params_json, created_at, completed_at FROM image_jobs WHERE user_id = ? AND status = ? AND CONCAT(COALESCE(display_url, ''), COALESCE(image_url, ''), COALESCE(original_url, '')) <> '' ORDER BY completed_at DESC, created_at DESC LIMIT 80");
    $stmt->execute([(int) $user['id'], 'completed']);
    return ['items' => array_map('client_generated_image', $stmt->fetchAll())];
}

function detach_or_purge_job_files(array $row): void
{
    $rowId = (int) ($row['id'] ?? 0);
    $wallItemId = (int) ($row['wall_item_id'] ?? 0);
    $wallStmt = pdo()->prepare('SELECT COUNT(*) FROM wall_items WHERE source_job_id = ? OR (? > 0 AND id = ?)');
    $wallStmt->execute([$rowId, $wallItemId, $wallItemId]);
    $hasWallReference = (int) $wallStmt->fetchColumn() > 0;

    if ($hasWallReference) {
        $detachWall = pdo()->prepare('UPDATE wall_items SET source_job_id = NULL WHERE source_job_id = ? OR (? > 0 AND id = ?)');
        $detachWall->execute([$rowId, $wallItemId, $wallItemId]);
        return;
    }

    delete_generated_image_files($row);
}

function handle_delete_generated_image(array $user, int $id): array
{
    if (!empty($user['isAdmin'])) {
        $stmt = pdo()->prepare('SELECT id, user_id, image_url, original_url, display_url, wall_item_id FROM image_jobs WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
    } else {
        $stmt = pdo()->prepare('SELECT id, user_id, image_url, original_url, display_url, wall_item_id FROM image_jobs WHERE id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$id, (int) $user['id']]);
    }
    $row = $stmt->fetch();
    if (!$row) return ['ok' => true, 'deleted' => false];

    detach_or_purge_job_files($row);

    $stmt = pdo()->prepare(!empty($user['isAdmin']) ? 'DELETE FROM image_jobs WHERE id = ?' : 'DELETE FROM image_jobs WHERE id = ? AND user_id = ?');
    $stmt->execute(!empty($user['isAdmin']) ? [$id] : [$id, (int) $user['id']]);
    return ['ok' => true, 'deleted' => $stmt->rowCount() > 0];
}

function handle_clear_generated_images(array $user): array
{
    $stmt = pdo()->prepare('SELECT id, image_url, original_url, display_url, wall_item_id FROM image_jobs WHERE user_id = ? AND status = ?');
    $stmt->execute([(int) $user['id'], 'completed']);
    $rows = $stmt->fetchAll();
    foreach ($rows as $row) {
        detach_or_purge_job_files($row);
    }

    $stmt = pdo()->prepare('DELETE FROM image_jobs WHERE user_id = ? AND status = ?');
    $stmt->execute([(int) $user['id'], 'completed']);
    return ['ok' => true, 'deleted' => $stmt->rowCount()];
}

function handle_save_generated_image(array $user, array $body): array
{
    $image = is_array($body['image'] ?? null) ? $body['image'] : [];
    $form = is_array($body['form'] ?? null) ? $body['form'] : [];
    $params = is_array($body['params'] ?? null) ? $body['params'] : $form;
    $stored = store_image_files($image);
    $requestId = preg_replace('/[^a-zA-Z0-9_.-]/', '-', (string) ($body['requestId'] ?? ($body['request_id'] ?? ('request-' . time()))));
    $mode = normalize_job_mode((string) ($body['mode'] ?? ($params['source'] ?? 'generation')));
    $prompt = trim((string) ($body['prompt'] ?? ($form['prompt'] ?? ($params['prompt'] ?? ''))));
    $revisedPrompt = normalize_revised_prompt($body);
    $resultImage = [
        'url' => $stored['displayUrl'],
        'image_url' => $stored['displayUrl'],
        'downloadUrl' => $stored['originalUrl'],
        'originalUrl' => $stored['originalUrl'],
        'imageMime' => $stored['imageMime'],
        'originalBytes' => $stored['originalBytes'],
        'displayBytes' => $stored['displayBytes'],
    ];
    if ($revisedPrompt !== '') $resultImage['revised_prompt'] = $revisedPrompt;

    $result = ['data' => [$resultImage]];
    $jobId = save_image_job($user, $requestId, $mode, $prompt ?: '未命名作品', ['form' => $form, 'params' => $params], $result);
    $stmt = pdo()->prepare('SELECT * FROM image_jobs WHERE id = ? AND user_id = ? LIMIT 1');
    $stmt->execute([$jobId, (int) $user['id']]);
    return ['item' => client_generated_image($stmt->fetch())];
}

function image_job_params(array $job): array
{
    if (empty($job['params_json'])) return [];
    $decoded = is_string($job['params_json']) ? json_decode($job['params_json'], true) : $job['params_json'];
    if (!is_array($decoded)) return [];
    if (is_array($decoded['form'] ?? null)) return $decoded['form'];
    if (is_array($decoded['params'] ?? null)) return $decoded['params'];
    if (is_array($decoded['payload'] ?? null)) return $decoded['payload'];
    if (is_array($decoded['fields'] ?? null)) return $decoded['fields'];
    return $decoded;
}