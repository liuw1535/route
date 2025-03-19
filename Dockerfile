FROM node:23-slim
WORKDIR /app

COPY package*.json ./
RUN npm install &&\
    mkdir ./logs &&\
    mkdir ./config
    
    
COPY ./config/config.js /app/config/
COPY ./config/config_waste.js /app/config/
COPY ./main.js /app
COPY ./health_check.js /app
COPY ./logger.js /app

CMD ["node","main.js"]