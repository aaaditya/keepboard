using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<SessionStore>();
builder.Services.AddSingleton<ClipStore>();
builder.Services.AddSignalR();

var frontendOrigin = Environment.GetEnvironmentVariable("FRONTEND_ORIGIN")
                     ?? "http://localhost:5173";

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (frontendOrigin == "*")
            policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
        else
            policy.WithOrigins(frontendOrigin.TrimEnd('/'))
                  .AllowAnyHeader()
                  .AllowAnyMethod();
    });
});

var app = builder.Build();
app.UseCors();

app.MapGet("/", () => Results.Ok(new
{
    name = "ClipBridge API",
    status = "ok",
    note = "Personal MVP API. Keep the access code private."
}));

app.MapPost("/api/session", (LoginRequest request, IConfiguration config, SessionStore sessions) =>
{
    var configuredCode = config["CLIP_ACCESS_CODE"];
    if (string.IsNullOrWhiteSpace(configuredCode))
        return Results.Problem("Server access code is not configured.", statusCode: 503);

    if (string.IsNullOrWhiteSpace(request.AccessCode) ||
        !CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(request.AccessCode),
            Encoding.UTF8.GetBytes(configuredCode)))
        return Results.Unauthorized();

    var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .Replace("+", "-").Replace("/", "_").TrimEnd('=');
    var expiresAt = DateTimeOffset.UtcNow.AddDays(7);
    sessions.Add(token, "personal", expiresAt);

    return Results.Ok(new SessionResponse(token, expiresAt));
});

app.MapGet("/api/clips/latest", (HttpContext context, SessionStore sessions, ClipStore clips) =>
{
    if (!TryGetSession(context, sessions, out _)) return Results.Unauthorized();
    return Results.Ok(clips.Latest);
});

app.MapPost("/api/clips", async (HttpContext context, SendClipRequest request,
    SessionStore sessions, ClipStore clips, IHubContext<ClipboardHub> hub) =>
{
    if (!TryGetSession(context, sessions, out var userId)) return Results.Unauthorized();

    if (string.IsNullOrWhiteSpace(request.Text))
        return Results.BadRequest(new { error = "Clip text cannot be empty." });

    if (request.Text.Length > 20_000)
        return Results.BadRequest(new { error = "Clip is too long (maximum 20,000 characters)." });

    var clip = new ClipDto(
        Guid.NewGuid().ToString("N"),
        request.Text,
        DateTimeOffset.UtcNow);

    clips.SetLatest(clip);
    await hub.Clients.Group(userId).SendAsync("ClipReceived", clip);
    return Results.Ok(clip);
});

app.MapHub<ClipboardHub>("/hubs/clipboard");

var renderPort = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(renderPort))
    app.Run($"http://0.0.0.0:{renderPort}");
else
    app.Run();

static bool TryGetSession(HttpContext context, SessionStore sessions, out string userId)
{
    userId = "";
    var header = context.Request.Headers.Authorization.ToString();
    if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return false;
    return sessions.TryGetUser(header["Bearer ".Length..].Trim(), out userId);
}

record LoginRequest(string AccessCode);
record SessionResponse(string Token, DateTimeOffset ExpiresAt);
record SendClipRequest(string Text);
record ClipDto(string Id, string Text, DateTimeOffset CreatedAt);

sealed class SessionStore
{
    private readonly ConcurrentDictionary<string, SessionEntry> _sessions = new();

    public void Add(string token, string userId, DateTimeOffset expiresAt) =>
        _sessions[token] = new SessionEntry(userId, expiresAt);

    public bool TryGetUser(string token, out string userId)
    {
        userId = "";
        if (!_sessions.TryGetValue(token, out var entry)) return false;
        if (entry.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            _sessions.TryRemove(token, out _);
            return false;
        }
        userId = entry.UserId;
        return true;
    }

    private sealed record SessionEntry(string UserId, DateTimeOffset ExpiresAt);
}

sealed class ClipStore
{
    private readonly object _lock = new();
    private ClipDto? _latest;
    public ClipDto? Latest { get { lock (_lock) return _latest; } }
    public void SetLatest(ClipDto clip) { lock (_lock) _latest = clip; }
}

sealed class ClipboardHub(SessionStore sessions) : Hub
{
    public async Task Join(string token)
    {
        if (!sessions.TryGetUser(token, out var userId))
            throw new HubException("Session expired. Sign in again.");
        await Groups.AddToGroupAsync(Context.ConnectionId, userId);
    }
}
