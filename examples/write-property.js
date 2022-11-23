const bacnet = require("../index");

const bacnetClient = new bacnet({
  broadcastSocket: false
});
const objectID = {
  type: bacnet.enum.ObjectTypesSupported.ANALOG_OUTPUT,
  instance: 10,
};

    bacnetClient.writeProperty(
      "10.0.1.23",
      objectID,
      85,
      [
        {
          type: bacnet.enum.ApplicationTag.REAL,
          value: 0,
        },
      ],
      (err, value) => {
        if (err) {
          console.error("Did not send: "+err.message);
        }
        bacnetClient.close();
      }
    );