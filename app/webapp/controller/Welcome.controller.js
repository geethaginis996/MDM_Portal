sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";

    return Controller.extend("mdm.portal.controller.Welcome", {

        onTilePress: function (oEvent) {
            var sRoute = oEvent.getSource().data("route");
            if (sRoute) {
                this.getOwnerComponent().getRouter().navTo(sRoute);
            }
        }

    });
});
