module.exports = function simulateSensors(sensorState, io) {

function randomLevel(base, variance) {
  return base + Math.random() * variance;
}

setInterval(() => {

  // simulate sound movement in room
  sensorState.sensor_1.level = randomLevel(20, 30);
  sensorState.sensor_2.level = randomLevel(40, 40);
  sensorState.sensor_3.level = randomLevel(10, 20);

  sensorState.sensor_1.raw = Math.floor(sensorState.sensor_1.level * 10);
  sensorState.sensor_2.raw = Math.floor(sensorState.sensor_2.level * 10);
  sensorState.sensor_3.raw = Math.floor(sensorState.sensor_3.level * 10);

  sensorState.sensor_1.updatedAt = Date.now();
  sensorState.sensor_2.updatedAt = Date.now();
  sensorState.sensor_3.updatedAt = Date.now();

  io.emit("sensorUpdate", sensorState);

}, 700);

}