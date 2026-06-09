sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Controller, Filter, FilterOperator) {
    "use strict";
    return Controller.extend("mdm.portal.controller.MasterDataTypes", {
        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query");
            var oTable = this.byId("mdtTable");
            var oBinding = oTable.getBinding("items");
            if (sQuery) {
                oBinding.filter([
                    new Filter("description", FilterOperator.Contains, sQuery)
                ]);
            } else {
                oBinding.filter([]);
            }
        },
        onSelect: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var oCtx  = oItem.getBindingContext();
            sap.m.MessageToast.show("Selected: " + oCtx.getProperty("description"));
        },
        onAdd: function () {
            sap.m.MessageToast.show("Add dialog — coming next!");
        }
    });
});