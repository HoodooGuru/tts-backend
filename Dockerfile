# Use official Python runtime as a parent image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the current directory contents into the container at /app
COPY server.py .
# (Optional) Copy other necessary files like deployment.md or specialized scripts if needed
# COPY . . 

# Make port 8000 available to the world outside this container
# note: AWS App Runner/ECS often map this dynamically, but usually default to 8080 or 80.
# server.py defaults to 8002, let's stick to one convention. 
# For Docker, standard 8000 or 80 is better. We will update CMD to use 8000.
EXPOSE 8000

# Define environment variable
ENV PORT=8000

# Run server.py when the container launches
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
