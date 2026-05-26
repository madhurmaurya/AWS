using System.ComponentModel.DataAnnotations;

namespace CalendarNotesApi.Models;

public class Note
{
    [Key]
    public Guid Id { get; set; }
    [Required]
    public string NoteDate { get; set; } = string.Empty; // Format: YYYY-MM-DD
    [Required]
    public string Content { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
}