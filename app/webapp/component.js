sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/odata/v4/ODataModel"
], function (UIComponent, ODataModel) {
    "use strict";
    return UIComponent.extend("mdm.portal.Component", {
        metadata: { manifest: "json" },
        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            this.getRouter().initialize();
        }
    });
});