document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM content loaded');
    
    const canvas = document.getElementById("bubbleCanvas");
    const ctx = canvas.getContext("2d");

    // Get the scroll-top section element
    const sectionTitle = document.getElementById("scroll-section");
  
    // Set initial canvas size based on window size
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  
    // Store the current section top position
    let sectionTop = sectionTitle.getBoundingClientRect().top;

  
  
    // Handle window resizing for the canvas
    window.addEventListener("resize", () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });

  
    
    // Mouse handling
    const mouse = { x: null, y: null, isDown: false };
    let activeBubble = null;
  
    window.addEventListener('mousedown', () => { mouse.isDown = true; });
    window.addEventListener('mouseup', () => {
      mouse.isDown = false;
      if (activeBubble) {
        activeBubble.isDragged = false;
        activeBubble = null;
      }
    });
    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    });
  
    // Bubble class
    class Bubble {
      constructor(x, y, radius, color, imageURL = null) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.vx = (Math.random() - 0.5) * 0.2;
        this.vy = (Math.random() - 0.5) * 0.2;
        this.baselineVx = (Math.random() - 0.5) * 0.3;
        this.baselineVy = (Math.random() - 0.5) * 0.3;
        this.isDragged = false;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.image = null;
        this.rotation = 0; // Initialize rotation
        this.rotationSpeed = (Math.random() - 0.5) * 0.02; // Each bubble rotates slightly differently
        this.currentRotationSpeed = this.rotationSpeed; // Current rotation speed (can change on collisions)

        if (imageURL) {
          this.image = new Image();
          this.image.src = imageURL;
        }
      }
  
      draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
  
        if (this.image) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(this.image, -this.radius, -this.radius, this.radius * 2, this.radius * 2);
          ctx.restore();
        }
  
        ctx.restore();
      }
  
      update(bubbles) {
        if (mouse.isDown && !activeBubble) {
          const dx = mouse.x - this.x;
          const dy = mouse.y - this.y;
          if (Math.sqrt(dx * dx + dy * dy) < this.radius) {
            this.isDragged = true;
            activeBubble = this;
            this.dragOffsetX = dx;
            this.dragOffsetY = dy;
          }
        }
  
        if (this.isDragged) {
            const newX = mouse.x - this.dragOffsetX;
            const newY = mouse.y - this.dragOffsetY;
            this.vx = newX - this.x;
            this.vy = newY - this.y;
            this.x = newX;
            this.y = newY;
            
            // Add some rotation when dragged
            this.currentRotationSpeed = (this.vx * 0.01) || this.rotationSpeed;
        } else {
            // Physics updates
            this.vx += this.baselineVx * 0.3;
            this.vy += this.baselineVy * 0.3;
            
            this.x += this.vx;
            this.y += this.vy;
            
            // Boundary checks
            const canvasRect = canvas.getBoundingClientRect();
            const bubbleBottomInDocument = this.y;
            
            if (this.y - canvas.getBoundingClientRect().top > sectionTitle.getBoundingClientRect().top - 250) {
                this.y = sectionTitle.getBoundingClientRect().top - 251;
                this.vy = 0;
            }
            
            if (this.x - this.radius < 0) {
                this.x = this.radius;
                this.vx *= -1;
                this.currentRotationSpeed = -this.vx * 0.01; // Add spin on bounce
            } else if (this.x + this.radius > canvas.width) {
                this.x = canvas.width - this.radius;
                this.vx *= -1;
                this.currentRotationSpeed = -this.vx * 0.01; // Add spin on bounce
            }
            
            if (this.y - this.radius < 0) {
                this.y = this.radius;
                this.vy *= -1;
                this.currentRotationSpeed = this.vy * 0.01; // Add spin on bounce
            } else if (this.y + this.radius > canvas.height) {
                this.y = canvas.height - this.radius;
                this.vy *= -1;
                this.currentRotationSpeed = this.vy * 0.01; // Add spin on bounce
            }
            
            // Apply friction
            this.vx *= 0.98;
            this.vy *= 0.98;
            
            // Gradually return to natural rotation speed
            this.currentRotationSpeed += (this.rotationSpeed - this.currentRotationSpeed) * 0.05;
            
            // Bubble collision with other bubbles
            for (let other of bubbles) {
                if (other === this) continue;
                const dx = other.x - this.x;
                const dy = other.y - this.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const minDist = this.radius + other.radius;
                if (dist < minDist) {
                    const angle = Math.atan2(dy, dx);
                    const overlap = (minDist - dist) / 2;
                    this.x -= Math.cos(angle) * overlap;
                    this.y -= Math.sin(angle) * overlap;
                    other.x += Math.cos(angle) * overlap;
                    other.y += Math.sin(angle) * overlap;
                    
                    // Calculate collision force for rotation effect
                    const force = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                    const collisionRotation = force * 0.01 * (Math.random() > 0.5 ? 1 : -1);
                    this.currentRotationSpeed += collisionRotation;
                    
                    [this.vx, other.vx] = [other.vx, this.vx];
                    [this.vy, other.vy] = [other.vy, this.vy];
                }
            }
        }
        
        // Update rotation based on current rotation speed
        this.rotation += this.currentRotationSpeed;
        
        // Keep rotation between 0 and 2π
        if (this.rotation > 2 * Math.PI) {
            this.rotation -= 2 * Math.PI;
        } else if (this.rotation < 0) {
            this.rotation += 2 * Math.PI;
        }
      }
    }
  
    // Bubble color and image
    const colors = {
      green: '#d1d866',  // assuming this is your green color
      blue: '#729ed4',   // your blue color
      pink: '#f4b2ae'    // your pink color
    };
    
    const imageURLs = [
      'TransparentPics/IMG-20250430-WA0002.jpg',
      'TransparentPics/IMG-20250430-WA0003.jpg',
      'TransparentPics/IMG-20250430-WA0004.jpg'
    ];
    
    const bubbles = [];
    const radius = 65;
    
    // Create 1 green bubble
    bubbles.push(new Bubble(
      Math.random() * (canvas.width - radius * 2) + radius,
      Math.random() * (canvas.height - radius * 2) + radius,
      radius,
      colors.green,
      null
    ));
    
    // Create 2 blue bubbles
    for (let i = 0; i < 2; i++) {
      bubbles.push(new Bubble(
        Math.random() * (canvas.width - radius * 2) + radius,
        Math.random() * (canvas.height - radius * 2) + radius,
        radius,
        colors.blue,
        null
      ));
    }
    
    // Create 2 pink bubbles
    for (let i = 0; i < 2; i++) {
      bubbles.push(new Bubble(
        Math.random() * (canvas.width - radius * 2) + radius,
        Math.random() * (canvas.height - radius * 2) + radius,
        radius,
        colors.pink,
        null
      ));
    }
    
    // Create 3 bubbles with images
    for (let i = 0; i < 3; i++) {
      bubbles.push(new Bubble(
        Math.random() * (canvas.width - radius * 2) + radius,
        Math.random() * (canvas.height - radius * 2) + radius,
        radius,
        null,  // no color if using image
        imageURLs[i % imageURLs.length]  // cycle through image URLs if you have fewer than 3
      ));
    }
  
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let b of bubbles) {
        b.update(bubbles);
        b.draw();
      }
      requestAnimationFrame(animate);
    }
  
    // Start the animation
    animate();
    
});