using Microsoft.EntityFrameworkCore;
using CalendarNotesApi.Models;

namespace CalendarNotesApi.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) {}
    public DbSet<Note> Notes => Set<Note>();
}