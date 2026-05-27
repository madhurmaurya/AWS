using Microsoft.EntityFrameworkCore;
using Amazon.Extensions.NETCore.Setup;
using Amazon.S3;
using CalendarNotesApi.Data;

var builder = WebApplication.CreateBuilder(args);
var myAllowSpecificOrigins = "_myAllowSpecificOrigins";

AWSOptions awsOptions = builder.Configuration.GetAWSOptions();
builder.Services.AddAWSService<IAmazonS3>(awsOptions);

builder.Services.AddCors(options =>
{
    options.AddPolicy(name: myAllowSpecificOrigins,
                      policy =>
                      {
                          policy.WithOrigins("http://localhost:3000", "http://Calendar-notes-env-env.eba-m3gxgt77.ap-south-1.elasticbeanstalk.com") // Add your Frontend URLs here (React, Vite, Angular, etc.)
                                .AllowAnyHeader()
                                .AllowAnyMethod();
                      });
});
builder.Services.AddControllers();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection"))); // Update to use your target engine driver string

var app = builder.Build();

// Automatically handle and execute database context migration tables tracking on execution runtime setup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
}

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRouting();
app.UseCors(myAllowSpecificOrigins);
app.MapControllers();

app.Run();