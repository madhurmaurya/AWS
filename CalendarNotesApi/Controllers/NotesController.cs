using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Amazon.S3;
using Amazon.S3.Transfer;
using CalendarNotesApi.Data;
using CalendarNotesApi.Models;

namespace CalendarNotesApi.Controllers;

[ApiController]
[Route("api/notes")]
public class NotesController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly IAmazonS3 _s3Client;
    private readonly IConfiguration _config;

    public NotesController(AppDbContext context, IAmazonS3 s3Client, IConfiguration config)
    {
        _context = context;
        _s3Client = s3Client;
        _config = config;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll() => Ok(await _context.Notes.ToListAsync());

    [HttpPost]
    public async Task<IActionResult> Create([FromForm] string content, [FromForm] string noteDate, IFormFile? image)
    {
        string imageUrl = string.Empty;
        string bucketName = _config["AWS:BucketName"] ?? "default-bucket-name";

        if (image != null)
        {
            var fileKey = $"{Guid.NewGuid()}_{image.FileName}";
            using var stream = image.OpenReadStream();
            
            var uploadRequest = new TransferUtilityUploadRequest
            {
                InputStream = stream,
                Key = fileKey,
                BucketName = bucketName
            };

            var transferUtility = new TransferUtility(_s3Client);
            await transferUtility.UploadAsync(uploadRequest);
            imageUrl = $"https://{bucketName}.s3.amazonaws.com/{fileKey}";
        }

        TimeSpan? startTime = null;
        TimeSpan? endTime = null;

        if (Request.Form.TryGetValue("startTime", out var startStr) && TimeSpan.TryParse(startStr, out var parsedStart))
            startTime = parsedStart;

        if (Request.Form.TryGetValue("endTime", out var endStr) && TimeSpan.TryParse(endStr, out var parsedEnd))
            endTime = parsedEnd;

        var note = new Note { Id = Guid.NewGuid(), Content = content, NoteDate = noteDate, ImageUrl = imageUrl, StartTime = startTime, EndTime = endTime };
        
        _context.Notes.Add(note);
        await _context.SaveChangesAsync();
        return Ok(note);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(Guid id, [FromForm] string content, [FromForm] string noteDate, IFormFile? image)
    {
        var note = await _context.Notes.FindAsync(id);
        if (note == null) return NotFound();

        note.Content = content;
        note.NoteDate = noteDate;

        if (Request.Form.TryGetValue("startTime", out var startStr) && TimeSpan.TryParse(startStr, out var parsedStart))
            note.StartTime = parsedStart;

        if (Request.Form.TryGetValue("endTime", out var endStr) && TimeSpan.TryParse(endStr, out var parsedEnd))
            note.EndTime = parsedEnd;

       if (image != null)
        {
            string bucketName = _config["AWS:BucketName"] ?? "default-bucket-name";

            // Delete old image from S3 if one exists
            if (!string.IsNullOrEmpty(note.ImageUrl))
            {
                var oldKey = note.ImageUrl.Replace($"https://{bucketName}.s3.amazonaws.com/", "");
                try
                {
                    await _s3Client.DeleteObjectAsync(bucketName, oldKey);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"S3 delete old image failed for key {oldKey}: {ex.Message}");
                }
            }

            // Upload new image
            var fileKey = $"{Guid.NewGuid()}_{image.FileName}";
            using var stream = image.OpenReadStream();

            var uploadRequest = new TransferUtilityUploadRequest
            {
                InputStream = stream,
                Key = fileKey,
                BucketName = bucketName
            };

            var transferUtility = new TransferUtility(_s3Client);
            await transferUtility.UploadAsync(uploadRequest);
            note.ImageUrl = $"https://{bucketName}.s3.amazonaws.com/{fileKey}";
        }

        await _context.SaveChangesAsync();
        return Ok(note);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var note = await _context.Notes.FindAsync(id);
        if (note == null) return NotFound();

        // Delete image from S3 if it exists
        if (!string.IsNullOrEmpty(note.ImageUrl))
        {
            string bucketName = _config["AWS:BucketName"] ?? "default-bucket-name";
            // Extract the file key from the URL
            // URL format: https://bucketname.s3.amazonaws.com/filekey
            var fileKey = note.ImageUrl.Replace($"https://{bucketName}.s3.amazonaws.com/", "");
            try
            {
                await _s3Client.DeleteObjectAsync(bucketName, fileKey);
            }
            catch (Exception ex)
            {
                // Log but don't fail — still delete the DB record
                Console.WriteLine($"S3 delete failed for key {fileKey}: {ex.Message}");
            }
        }

        _context.Notes.Remove(note);
        await _context.SaveChangesAsync();
        return Ok();
    }
}