sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ReleaseCodeDetail", {
        onBackToCriteria: function () {
            this.getOwnerComponent().getRouter().navTo("releaseCriteria");
        }
    });
});
