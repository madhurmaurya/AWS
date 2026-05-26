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

        var note = new Note { Id = Guid.NewGuid(), Content = content, NoteDate = noteDate, ImageUrl = imageUrl };
        _context.Notes.Add(note);
        await _context.SaveChangesAsync();
        return Ok(note);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var note = await _context.Notes.FindAsync(id);
        if (note == null) return NotFound();
        _context.Notes.Remove(note);
        await _context.SaveChangesAsync();
        return Ok();
    }
}