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
                          policy.WithOrigins("http://localhost:3000", "http://static-bucket-for-calendar.s3-website.ap-south-1.amazonaws.com") // Add your Frontend URLs here (React, Vite, Angular, etc.)
                                .AllowAnyHeader()
                                .AllowAnyMethod();
                      });
});
builder.Services.AddControllers();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection"))); // Update to use your target engine driver string

var secretArn = builder.Configuration["AWS:SecretsManagerArn"];
if (!string.IsNullOrEmpty(secretArn))
{
    // Fetch from Secrets Manager at startup
    var smClient = new Amazon.SecretsManager.AmazonSecretsManagerClient();
    var response = await smClient.GetSecretValueAsync(new Amazon.SecretsManager.Model.GetSecretValueRequest
    {
        SecretId = secretArn
    });
    var secret = System.Text.Json.JsonDocument.Parse(response.SecretString);
    var host = secret.RootElement.GetProperty("host").GetString();
    var username = secret.RootElement.GetProperty("username").GetString();
    var password = secret.RootElement.GetProperty("password").GetString();
    var connStr = $"Host={host};Port=5432;Database=calendardb;Username={username};Password={password};SSL Mode=Require;Trust Server Certificate=true";
    builder.Configuration["ConnectionStrings:DefaultConnection"] = connStr;
}

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